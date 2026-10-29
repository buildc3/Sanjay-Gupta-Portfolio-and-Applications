import { getStore } from "@netlify/blobs";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";

// ---- Lists (from the Excel "Lists" sheet) ----
const PRODUCTS = ["Insurance", "Mutual Fund", "Corporate FD", "Loan", "PMS", "AIF", "54EC Capital Gain Bonds", "Other"];
const PARTNER_STATUS = ["Prospect", "Active", "Inactive", "On Hold"];
const BUSINESS_STATUS = ["Lead", "Documents Pending", "Submitted", "Under Process", "Approved", "Rejected", "Paid"];
const PAYOUT_MODES = ["Automatic", "Manual"];
const PROFESSIONS = ["Chartered Accountant", "Financial Advisor", "Business Owner", "Salaried Employee", "Insurance Advisor", "Other"];

const COLLECTIONS = {
  partners: {
    sheet: "Partners", prefix: "D", pad: 4,
    required: ["name"],
    fields: ["name", "phone", "email", "address", "profession", "pan", "dob", "joinDate", "status", "followUp", "remarks"],
  },
  businesses: {
    sheet: "Business Logins", prefix: "L", pad: 5,
    required: ["partnerId", "customer", "loginDate", "product", "company", "amount"],
    fields: ["partnerId", "customer", "loginDate", "product", "company", "amount", "term", "payoutMode", "manualOverride", "status", "followUp", "paymentDate", "notes", "docLink"],
  },
  rates: {
    sheet: "Commission Rates", prefix: "R", pad: 4,
    required: ["product", "company", "rate"],
    fields: ["product", "company", "rate", "effectiveFrom", "effectiveTo", "notes"],
  },
};

// ---- Documents: files live in a private Supabase Storage bucket, their list lives on the record ----
const DOC_BUCKET = process.env.SUPABASE_BUCKET || "partner-documents";
const DOC_MAX_BYTES = 4 * 1024 * 1024; // Netlify function request bodies are capped at ~6 MB (less once base64 encoded)
const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const UPLOAD_WINDOW_MS = 15 * 60 * 1000; // how long a visitor without the passcode may attach files to a record they just created

let supa;
function supabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return (supa ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));
}

// Token handed back on a public create so that visitor can upload files for that one record only
const uploadToken = (name, rec) => createHmac("sha256", process.env.APP_PASSCODE).update(`${name}/${rec.id}/${rec.createdAt}`).digest("hex");
function validUploadToken(name, rec, token) {
  if (!token || Date.now() - Date.parse(rec.createdAt) > UPLOAD_WINDOW_MS) return false;
  const a = Buffer.from(uploadToken(name, rec)), b = Buffer.from(String(token));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handleDocuments(req, store, authed, [kind, id, docId]) {
  if (!COLLECTIONS[kind] || kind === "rates" || !id) return json({ error: "Not found" }, 404);
  const sb = supabase();
  if (!sb) return json({ error: "Document storage not configured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" }, 500);
  const key = `${kind}/${id}`;
  const rec = await store.get(key, { type: "json" });
  if (!rec) return json({ error: "Not found" }, 404);
  const docs = rec.docs || [];

  if (req.method === "POST") {
    if (!authed && !validUploadToken(kind, rec, req.headers.get("x-upload-token"))) return json({ error: "Passcode required" }, 401);
    const type = (req.headers.get("content-type") || "").split(";")[0];
    if (!DOC_TYPES.includes(type)) return json({ error: "Only PDF, JPG, PNG or Word files are allowed" }, 400);
    const body = new Uint8Array(await req.arrayBuffer());
    if (!body.length) return json({ error: "Empty file" }, 400);
    if (body.length > DOC_MAX_BYTES) return json({ error: "File is larger than 4 MB" }, 413);
    let fileName = req.headers.get("x-filename") || "document";
    try { fileName = decodeURIComponent(fileName); } catch {}
    fileName = fileName.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 120) || "document";
    const doc = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: fileName, type, size: body.length, uploadedAt: new Date().toISOString() };
    doc.path = `${kind}/${id}/${doc.id}-${fileName.replace(/[^\w.-]+/g, "_")}`;
    const { error } = await sb.storage.from(DOC_BUCKET).upload(doc.path, body, { contentType: type, upsert: false });
    if (error) return json({ error: "Upload failed: " + error.message }, 502);
    // Re-read so a second file uploaded in parallel is not lost
    const fresh = (await store.get(key, { type: "json" })) || rec;
    await store.setJSON(key, { ...fresh, docs: [...(fresh.docs || []), doc] });
    return json({ ok: true, doc: authed ? doc : { name: doc.name } });
  }

  if (!authed) return json({ error: "Passcode required" }, 401);
  const doc = docs.find((d) => d.id === docId);
  if (!doc) return json({ error: "Document not found" }, 404);

  if (req.method === "GET") {
    // ?download=1 forces a file download; otherwise the URL serves the file inline for previewing
    const download = new URL(req.url).searchParams.has("download");
    const { data, error } = await sb.storage.from(DOC_BUCKET).createSignedUrl(doc.path, 60, download ? { download: doc.name } : undefined);
    if (error) return json({ error: error.message }, 502);
    return json({ url: data.signedUrl });
  }
  if (req.method === "DELETE") {
    const { error } = await sb.storage.from(DOC_BUCKET).remove([doc.path]);
    if (error) return json({ error: error.message }, 502);
    await store.setJSON(key, { ...rec, docs: docs.filter((d) => d.id !== docId) });
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));

// ---- Derived fields: Partner Name, Month, Commission Rate, Auto Payout, Final Payout ----
function enrichBusiness(b, partners, rates) {
  const p = partners.find((x) => x.id === b.partnerId);
  const matches = rates.filter(
    (r) =>
      r.product === b.product && r.company?.trim().toLowerCase() === b.company?.trim().toLowerCase() &&
      (!r.effectiveFrom || !b.loginDate || r.effectiveFrom <= b.loginDate) &&
      (!r.effectiveTo || !b.loginDate || r.effectiveTo >= b.loginDate),
  );
  const rate = matches.reduce((s, r) => s + (num(r.rate) || 0), 0);
  const amount = num(b.amount);
  const manual = num(b.manualOverride);
  const auto = amount != null && rate > 0 ? Math.round(amount * rate * 100) / 100 : null;
  const month = b.loginDate ? new Date(b.loginDate + "T00:00:00Z").toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).replace(" ", "-") : "";
  return { ...b, partnerName: p?.name || "", month, commissionRate: rate, autoPayout: auto, finalPayout: manual != null ? manual : auto };
}

async function loadAll(store) {
  const out = {};
  for (const name of Object.keys(COLLECTIONS)) {
    const { blobs } = await store.list({ prefix: name + "/" });
    const rows = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
    out[name] = rows.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
  }
  return out;
}

// ---- Google Sheets mirror (via the Apps Script web app in google-apps-script/Code.gs) ----
async function mirror(payload) {
  const url = process.env.GOOGLE_SCRIPT_URL;
  if (!url) return { ok: false, skipped: true };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ secret: process.env.GOOGLE_SCRIPT_SECRET || "", ...payload }),
    });
    const data = await res.json();
    return { ok: !!data.ok, error: data.error };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function clean(def, input) {
  const rec = {};
  for (const f of def.fields) rec[f] = typeof input[f] === "string" ? input[f].trim() : input[f] ?? "";
  if (rec.pan) rec.pan = String(rec.pan).toUpperCase();
  return rec;
}

function validate(name, rec, data) {
  const def = COLLECTIONS[name];
  for (const f of def.required) if (rec[f] === "" || rec[f] == null) return `${f} is required`;
  if (name === "partners") {
    if (rec.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(rec.pan)) return "PAN must look like ABCDE1234F";
    if (rec.status && !PARTNER_STATUS.includes(rec.status)) return "Invalid partner status";
  }
  if (name === "businesses") {
    if (!data.partners.some((p) => p.id === rec.partnerId)) return "Unknown Partner ID";
    if (!PRODUCTS.includes(rec.product)) return "Invalid product";
    if (rec.status && !BUSINESS_STATUS.includes(rec.status)) return "Invalid status";
    if (num(rec.amount) == null || num(rec.amount) < 0) return "Amount must be a number";
  }
  if (name === "rates" && (num(rec.rate) == null || num(rec.rate) < 0 || num(rec.rate) > 1)) return "Rate must be a decimal between 0 and 1";
  return null;
}

export default async (req) => {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return json({ error: "Server not configured: APP_PASSCODE missing" }, 500);
  const authed = req.headers.get("x-passcode") === passcode;
  if (req.headers.get("x-passcode") && !authed) return json({ error: "Wrong passcode" }, 401);

  const store = getStore({ name: "partner-management", consistency: "strong" });
  const parts = new URL(req.url).pathname.replace(/^\/(\.netlify\/functions\/api|api)\/?/, "").split("/").filter(Boolean);
  const [name, id] = parts;

  // Without the passcode a visitor may only ADD partners and business logins. Reading, editing,
  // deleting and rate changes all need it, and the response reveals nothing about stored data.
  // Uploading documents is also allowed with the upload token returned by that public create.
  if (name === "documents") return handleDocuments(req, store, authed, parts.slice(1));
  const publicCreate = req.method === "POST" && (name === "partners" || name === "businesses");
  if (!authed && !publicCreate) return json({ error: "Passcode required" }, 401);

  if (req.method === "GET" && (name === "data" || !name)) {
    const data = await loadAll(store);
    data.businesses = data.businesses.map((b) => enrichBusiness(b, data.partners, data.rates));
    return json({ ...data, lists: { PRODUCTS, PARTNER_STATUS, BUSINESS_STATUS, PAYOUT_MODES, PROFESSIONS }, googleSheets: !!process.env.GOOGLE_SCRIPT_URL });
  }

  const def = COLLECTIONS[name];
  if (!def) return json({ error: "Not found" }, 404);

  let input = {};
  if (req.method === "POST" || req.method === "PUT") {
    try { input = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  }
  const data = await loadAll(store);

  if (req.method === "DELETE" && id) {
    const docs = data[name].find((r) => r.id === id)?.docs || [];
    if (docs.length) await supabase()?.storage.from(DOC_BUCKET).remove(docs.map((d) => d.path));
    await store.delete(`${name}/${id}`);
    const sheets = await mirror({ sheet: def.sheet, action: "delete", id });
    return json({ ok: true, sheets });
  }

  if (req.method === "POST" || (req.method === "PUT" && id)) {
    const rec = clean(def, input);
    const err = validate(name, rec, data);
    if (err) return json({ error: err }, 400);

    if (req.method === "POST") {
      const max = data[name].reduce((m, r) => Math.max(m, parseInt(r.id.slice(def.prefix.length), 10) || 0), 0);
      rec.id = def.prefix + String(max + 1).padStart(def.pad, "0");
      rec.createdAt = new Date().toISOString();
    } else {
      const existing = data[name].find((r) => r.id === id);
      if (!existing) return json({ error: "Not found" }, 404);
      rec.id = id;
      rec.createdAt = existing.createdAt;
      if (existing.docs) rec.docs = existing.docs;
    }
    rec.updatedAt = new Date().toISOString();
    await store.setJSON(`${name}/${rec.id}`, rec);

    const forSheet = name === "businesses" ? enrichBusiness(rec, data.partners, data.rates) : rec;
    const sheets = await mirror({ sheet: def.sheet, action: "upsert", record: forSheet });
    if (!authed) return json({ ok: true, record: { id: rec.id }, uploadToken: uploadToken(name, rec), sheets: { ok: sheets.ok, skipped: sheets.skipped } });
    return json({ ok: true, record: forSheet, sheets });
  }

  return json({ error: "Method not allowed" }, 405);
};
