import { getStore } from "@netlify/blobs";

// Stock Inward Register.
//   lot  (purchase): { id: S0001, article, quantity, purchasePrice, date, sold, remaining }
//   sale:            { id: T0001, article, quantity, salePrice, date, costTotal, saleTotal, profit, allocations }
// A sale draws down the oldest purchase lots first (FIFO) and updates each lot it touches.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const round = (n) => Math.round(n * 1e6) / 1e6;
const money = (n) => Math.round(n * 100) / 100;
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const positive = (v) => v !== "" && v != null && Number.isFinite(Number(v)) && Number(v) > 0;
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

async function mirror(sheet, record) {
  const url = process.env.GOOGLE_SCRIPT_URL;
  if (!url) return { ok: false, skipped: true };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ secret: process.env.GOOGLE_SCRIPT_SECRET || "", sheet, action: "upsert", record }),
    });
    const data = await res.json();
    return { ok: !!data.ok, error: data.error };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function loadAll(store) {
  const out = {};
  for (const name of ["lots", "sales"]) {
    const { blobs } = await store.list({ prefix: name + "/" });
    const rows = await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })));
    out[name] = rows.filter(Boolean);
  }
  out.lots.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  out.sales.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return out;
}

const nextId = (rows, prefix, pad) =>
  prefix + String(rows.reduce((m, r) => Math.max(m, parseInt(r.id.slice(prefix.length), 10) || 0), 0) + 1).padStart(pad, "0");

function available(lots) {
  const map = new Map();
  for (const l of lots) {
    if (l.remaining <= 0) continue;
    const k = l.article.trim().toLowerCase();
    const cur = map.get(k) || { article: l.article, quantity: 0 };
    cur.quantity = round(cur.quantity + l.remaining);
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => a.article.localeCompare(b.article));
}

export default async (req) => {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return json({ error: "Server not configured: APP_PASSCODE missing" }, 500);
  if (req.headers.get("x-passcode") !== passcode) return json({ error: "Passcode required" }, 401);

  const store = getStore({ name: "stock-register", consistency: "strong" });
  const action = new URL(req.url).pathname.replace(/^\/(\.netlify\/functions\/stock|api\/stock)\/?/, "").split("/").filter(Boolean)[0] || "";
  const data = await loadAll(store);

  if (req.method === "GET") return json({ ...data, available: available(data.lots), googleSheets: !!process.env.GOOGLE_SCRIPT_URL });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let b;
  try { b = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const now = new Date().toISOString();

  if (action === "buy") {
    const article = String(b.article || "").trim();
    if (!article) return json({ error: "Name of Article is required" }, 400);
    if (!positive(b.quantity)) return json({ error: "Quantity must be greater than 0" }, 400);
    if (b.purchasePrice === "" || b.purchasePrice == null || !Number.isFinite(Number(b.purchasePrice)) || Number(b.purchasePrice) < 0) return json({ error: "Purchase Price must be a number" }, 400);
    if (!validDate(b.date)) return json({ error: "Date is required" }, 400);

    // Reuse the spelling already in the register so "Rice" and "rice" stay one article.
    const known = data.lots.find((l) => same(l.article, article));
    const lot = {
      id: nextId(data.lots, "S", 4), article: known ? known.article : article,
      quantity: round(Number(b.quantity)), purchasePrice: money(Number(b.purchasePrice)), date: b.date,
      sold: 0, remaining: round(Number(b.quantity)), createdAt: now, updatedAt: now,
    };
    await store.setJSON(`lots/${lot.id}`, lot);
    return json({ ok: true, lot, sheets: await mirror("Stock Inward", lot) });
  }

  if (action === "sell") {
    const article = String(b.article || "").trim();
    if (!article) return json({ error: "Choose an article to sell" }, 400);
    if (!positive(b.quantity)) return json({ error: "Quantity must be greater than 0" }, 400);
    if (b.salePrice === "" || b.salePrice == null || !Number.isFinite(Number(b.salePrice)) || Number(b.salePrice) < 0) return json({ error: "Sale Price must be a number" }, 400);
    if (!validDate(b.date)) return json({ error: "Date is required" }, 400);

    const qty = round(Number(b.quantity));
    const lots = data.lots.filter((l) => same(l.article, article) && l.remaining > 0);
    const have = round(lots.reduce((s, l) => s + l.remaining, 0));
    if (!lots.length) return json({ error: "No stock available for that article" }, 400);
    if (qty > have) return json({ error: `Only ${have} available` }, 400);

    let left = qty, costTotal = 0;
    const allocations = [], touched = [];
    for (const lot of lots) { // already oldest-first
      if (left <= 0) break;
      const take = round(Math.min(left, lot.remaining));
      lot.sold = round(lot.sold + take); lot.remaining = round(lot.remaining - take); lot.updatedAt = now;
      costTotal += take * lot.purchasePrice; left = round(left - take);
      allocations.push({ lotId: lot.id, quantity: take, purchasePrice: lot.purchasePrice });
      touched.push(lot);
    }
    const salePrice = money(Number(b.salePrice));
    const sale = {
      id: nextId(data.sales, "T", 4), article: lots[0].article, quantity: qty, salePrice, date: b.date,
      costTotal: money(costTotal), saleTotal: money(qty * salePrice), profit: money(qty * salePrice - costTotal),
      allocations, createdAt: now,
    };
    await store.setJSON(`sales/${sale.id}`, sale);
    for (const lot of touched) await store.setJSON(`lots/${lot.id}`, lot);

    const sheets = [await mirror("Stock Sales", { ...sale, allocations: allocations.map((a) => `${a.lotId}×${a.quantity}`).join(", ") })];
    for (const lot of touched) sheets.push(await mirror("Stock Inward", lot));
    return json({ ok: true, sale, lots: touched, sheets: sheets.every((s) => s.ok) ? { ok: true } : sheets.every((s) => s.skipped) ? { skipped: true } : { ok: false, error: sheets.find((s) => s.error)?.error } });
  }

  return json({ error: "Not found" }, 404);
};
