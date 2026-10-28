const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => (n == null || n === "" ? "" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const today = () => new Date().toISOString().slice(0, 10);

const LISTS = {
  PRODUCTS: ["Insurance", "Mutual Fund", "Corporate FD", "Loan", "PMS", "AIF", "54EC Capital Gain Bonds", "Other"],
  PARTNER_STATUS: ["Prospect", "Active", "Inactive", "On Hold"],
  BUSINESS_STATUS: ["Lead", "Documents Pending", "Submitted", "Under Process", "Approved", "Rejected", "Paid"],
  PAYOUT_MODES: ["Automatic", "Manual"],
  PROFESSIONS: ["Chartered Accountant", "Financial Advisor", "Business Owner", "Salaried Employee", "Insurance Advisor", "Other"],
};
let pass = sessionStorage.getItem("pm-pass") || "";
let D = null;      // all stored data; null until the passcode has been entered
let tab = "addPartner";
const PROTECTED = ["dashboard", "partners", "businesses", "rates", "followups"]; // tabs that display stored data
let editing = null; // {kind, id}
const search = { partners: "", businesses: "" };

function toast(msg, err) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : "");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hide"), err ? 6000 : 2800);
}

async function api(path, method = "GET", body) {
  const res = await fetch("/api/" + path, { method, headers: { ...(pass ? { "x-passcode": pass } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && pass) { sessionStorage.removeItem("pm-pass"); pass = ""; D = null; render(); throw new Error("Wrong passcode"); }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function load() { D = await api("data"); }

async function unlock() {
  await load();
  const b = $("#sheetsBadge");
  b.textContent = D.googleSheets ? "Google Sheets sync on" : "Google Sheets sync off";
  b.style.color = D.googleSheets ? "var(--accent2)" : "var(--warn)";
  render();
}

// Inline passcode prompt shown wherever stored data would appear
const gateHTML = (msg) => `<div class="card gate" style="max-width:420px"><h3>🔒 Passcode required</h3><p class="hint">${msg || "This section shows stored partner and customer data."}</p>
  <form class="gateForm" style="display:grid;gap:10px;margin-top:12px"><input type="password" name="pass" autocomplete="current-password" placeholder="Passcode" required><button class="btn">Unlock</button></form></div>`;
function bindGate(root) {
  root.querySelectorAll(".gateForm").forEach((f) => (f.onsubmit = async (e) => {
    e.preventDefault(); const entered = new FormData(f).get("pass"); const prev = pass; pass = entered;
    try { await unlock(); sessionStorage.setItem("pm-pass", pass); } catch (err) { pass = prev; D = null; toast(err.message === "Passcode required" ? "Wrong passcode" : err.message, true); }
  }));
}

const TABS = [["dashboard", "Dashboard"], ["addPartner", "Add Partner"], ["addBusiness", "Add Business Login"], ["partners", "Partners"], ["businesses", "Business Logins"], ["rates", "Commission Rates"], ["followups", "Follow-ups"]];
function go(t) { tab = t; if (!["addPartner", "addBusiness", "rates"].includes(t)) editing = null; render(); }

function render() {
  $("#tabs").innerHTML = TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${!D && PROTECTED.includes(k) ? "🔒 " : ""}${l}</button>`).join("");
  $("#tabs").onclick = (e) => e.target.dataset.t && go(e.target.dataset.t);
  const v = $("#view");
  if (!D && PROTECTED.includes(tab)) { v.innerHTML = gateHTML(); bindGate(v); return; }
  ({ dashboard, addPartner, addBusiness, partners, businesses, rates, followups })[tab](v);
}

// ---------- shared helpers ----------
const isOpen = (b) => b.status !== "Paid" && b.status !== "Rejected";
const overdueDays = (b) => (b.followUp && isOpen(b) ? Math.max(0, Math.floor((Date.parse(today()) - Date.parse(b.followUp)) / 864e5)) : "");
const opts = (list, sel, blank) => (blank ? `<option value="">${esc(blank)}</option>` : "") + list.map((x) => `<option ${x === sel ? "selected" : ""}>${esc(x)}</option>`).join("");
const matches = (obj, q) => !q || Object.values(obj).some((v) => String(v ?? "").toLowerCase().includes(q.toLowerCase()));

function table(cols, rows, actions) {
  if (!rows.length) return `<p class="hint">No records yet.</p>`;
  return `<div class="tablewrap"><table><thead><tr>${cols.map((c) => `<th class="${c.n ? "n" : ""}">${c.h}</th>`).join("")}${actions ? "<th></th>" : ""}</tr></thead><tbody>${rows
    .map((r) => `<tr>${cols.map((c) => `<td class="${c.n ? "n" : ""}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join("")}${actions ? `<td>${actions(r)}</td>` : ""}</tr>`)
    .join("")}</tbody></table></div>`;
}
const rowBtns = (kind) => (r) => `<button class="btn ghost sm" data-edit="${kind}:${esc(r.id)}">Edit</button> <button class="btn danger sm" data-del="${kind}:${esc(r.id)}">Delete</button>`;

document.addEventListener("click", async (e) => {
  const ed = e.target.dataset?.edit, del = e.target.dataset?.del;
  if (ed) { const [kind, id] = ed.split(":"); editing = { kind, id }; tab = { partners: "addPartner", businesses: "addBusiness", rates: "rates" }[kind]; render(); scrollTo(0, 0); }
  if (del) {
    const [kind, id] = del.split(":");
    if (!confirm(`Delete ${id}? This removes it from the app and Google Sheets.`)) return;
    try { const r = await api(`${kind}/${id}`, "DELETE"); await load(); render(); sheetNote(r.sheets, "Deleted"); } catch (err) { toast(err.message, true); }
  }
});

function sheetNote(s, what) {
  if (s?.skipped) toast(`${what}. Saved to Netlify Blobs (Google Sheets not connected).`);
  else if (s?.ok) toast(`${what}. Saved to Netlify Blobs and Google Sheets.`);
  else toast(`${what} in Netlify Blobs, but Google Sheets failed: ${s?.error || "unknown"}`, true);
}

function bindSearch(kind, v) {
  const box = $("#q", v); if (!box) return;
  box.value = search[kind]; box.oninput = () => { search[kind] = box.value; const pos = box.selectionStart; render(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); };
}

function bindForm(v, kind, defaults) {
  $("form.f", v).onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    if (body.rate !== undefined) body.rate = body.rate === "" ? "" : Number(body.rate) / 100; // % -> decimal
    const btn = $("button.btn", e.target); btn.disabled = true;
    try {
      const r = editing ? await api(`${kind}/${editing.id}`, "PUT", body) : await api(kind, "POST", body);
      if (D) await load();
      const wasEdit = !!editing; editing = null; render();
      sheetNote(r.sheets, wasEdit ? `Updated ${r.record.id}` : `Saved ${r.record.id}`);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
  $("#cancel", v)?.addEventListener("click", () => { editing = null; render(); });
}

// ---------- Dashboard ----------
function dashboard(v) {
  const P = D.partners, B = D.businesses, sum = (k) => B.reduce((s, b) => s + (Number(b[k]) || 0), 0);
  const due = B.filter((b) => b.followUp && b.followUp <= today() && isOpen(b)).length;
  const k = (l, val) => `<div class="kpi"><small>${l}</small><b>${val}</b></div>`;
  v.innerHTML = `<div class="kpis">${k("TOTAL PARTNERS", P.length)}${k("ACTIVE PARTNERS", P.filter((p) => p.status === "Active").length)}${k("TOTAL BUSINESS CASES", B.length)}${k("PENDING CASES", B.filter(isOpen).length)}
  ${k("TOTAL BUSINESS AMOUNT", inr(sum("amount")))}${k("EXPECTED PAYOUT", inr(sum("autoPayout")))}${k("FINAL PAYOUT", inr(sum("finalPayout")))}${k("FOLLOW-UPS DUE", due)}</div>
  <p class="hint" style="margin-top:18px">Data is stored in Netlify Blobs and mirrored to Google Sheets on every save. This site holds personal data, so it is passcode protected.</p>`;
}

// ---------- Add / search partners ----------
function addPartner(v) {
  const e = D && editing?.kind === "partners" ? D.partners.find((p) => p.id === editing.id) : {};
  const f = (k, d = "") => esc(e[k] ?? d);
  v.innerHTML = `<h3>${e.id ? "Edit " + esc(e.id) : "Add Partner"}</h3>
  <form class="f">
    <label>Full Name *<input name="name" required value="${f("name")}"></label>
    <label>Contact Number<input name="phone" inputmode="tel" value="${f("phone")}"></label>
    <label>Email ID<input name="email" type="email" value="${f("email")}"></label>
    <label>Current Profession<select name="profession">${opts(LISTS.PROFESSIONS, e.profession, "Select…")}</select></label>
    <label>PAN Number<input name="pan" maxlength="10" pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]" placeholder="ABCDE1234F" value="${f("pan")}"></label>
    <label>Date of Birth<input name="dob" type="date" value="${f("dob")}"></label>
    <label>Joining Date<input name="joinDate" type="date" value="${f("joinDate", today())}"></label>
    <label>Partner Status<select name="status">${opts(LISTS.PARTNER_STATUS, e.status || "Prospect")}</select></label>
    <label>Follow-up Date<input name="followUp" type="date" value="${f("followUp")}"></label>
    <label class="wide">Address<input name="address" value="${f("address")}"></label>
    <label class="wide">Remarks<textarea name="remarks" rows="2">${f("remarks")}</textarea></label>
    <div class="actions"><button class="btn">${e.id ? "Update Partner" : "Save Partner"}</button>${e.id ? '<button type="button" id="cancel" class="btn ghost">Cancel</button>' : ""}</div>
  </form>
  <h3 style="margin-top:28px">Search Partners</h3>
  <div class="bar"><input id="q" placeholder="Search by ID or name"></div>
  <div id="res"></div>`;
  bindForm(v, "partners");
  if (!D) { $("#res", v).innerHTML = gateHTML("Searching existing partners shows stored data."); bindGate(v); return; }
  bindSearch("partners", v);
  const q = search.partners.trim();
  $("#res", v).innerHTML = q ? table(partnerCols, D.partners.filter((p) => p.id.toLowerCase().includes(q.toLowerCase()) || p.name.toLowerCase().includes(q.toLowerCase())), rowBtns("partners")) : `<p class="hint">Type to search existing partners.</p>`;
}
const partnerCols = [["id", "Partner ID"], ["name", "Full Name"], ["phone", "Contact"], ["email", "Email"], ["address", "Address"], ["profession", "Profession"], ["pan", "PAN"], ["dob", "DOB"], ["joinDate", "Joined"], ["status", "Status"], ["followUp", "Follow-up"], ["remarks", "Remarks"]].map(([k, h]) => ({ k, h }));

function partners(v) {
  v.innerHTML = `<div class="bar"><input id="q" placeholder="Filter partners…"></div><div id="res"></div>`;
  bindSearch("partners", v);
  $("#res", v).innerHTML = table(partnerCols, D.partners.filter((p) => matches(p, search.partners)), rowBtns("partners"));
}

// ---------- Add / search business ----------
const bizCols = [
  { k: "id", h: "Login ID" }, { k: "partnerId", h: "Partner ID" }, { k: "partnerName", h: "Partner" }, { k: "customer", h: "Customer" }, { k: "loginDate", h: "Login Date" }, { k: "month", h: "Month" },
  { k: "product", h: "Product" }, { k: "company", h: "Company" }, { h: "Amount", n: 1, f: (b) => inr(b.amount) }, { k: "term", h: "Term (Yrs)", n: 1 }, { k: "payoutMode", h: "Mode" },
  { h: "Rate", n: 1, f: (b) => (b.commissionRate ? +(b.commissionRate * 100).toFixed(4) + "%" : "") }, { h: "Manual", n: 1, f: (b) => inr(b.manualOverride) },
  { h: "Auto Payout", n: 1, f: (b) => inr(b.autoPayout) }, { h: "Final Payout", n: 1, f: (b) => `<b>${inr(b.finalPayout)}</b>` }, { k: "status", h: "Status" }, { k: "followUp", h: "Follow-up" },
  { k: "paymentDate", h: "Paid On" }, { k: "notes", h: "Notes" }, { h: "Document", f: (b) => (/^https?:\/\//i.test(b.docLink) ? `<a href="${esc(b.docLink)}" target="_blank" rel="noopener">Open</a>` : esc(b.docLink)) },
];

function addBusiness(v) {
  if (D && !D.partners.length) { v.innerHTML = `<p>Add a partner first, since each business login belongs to a Partner ID.</p>`; return; }
  const e = D && editing?.kind === "businesses" ? D.businesses.find((b) => b.id === editing.id) : {};
  const f = (k, d = "") => esc(e[k] ?? d);
  v.innerHTML = `<h3>${e.id ? "Edit " + esc(e.id) : "Add Business Login"}</h3>
  <form class="f">
    <label>Partner ${D ? "" : "ID "}*${D ? `<select name="partnerId" required>${D.partners.map((p) => `<option value="${esc(p.id)}" ${p.id === e.partnerId ? "selected" : ""}>${esc(p.id)} — ${esc(p.name)}</option>`).join("")}</select>` : `<input name="partnerId" required placeholder="e.g. D0001" pattern="D[0-9]{4,}" title="Partner ID like D0001">`}</label>
    <label>Customer Name *<input name="customer" required value="${f("customer")}"></label>
    <label>Login Date *<input name="loginDate" type="date" required value="${f("loginDate", today())}"></label>
    <label>Product *<select name="product" required>${opts(LISTS.PRODUCTS, e.product)}</select></label>
    <label>Company *<input name="company" required list="companies" value="${f("company")}"><datalist id="companies">${[...new Set((D?.rates || []).map((r) => r.company))].map((c) => `<option>${esc(c)}</option>`).join("")}</datalist></label>
    <label>Premium / Investment Amount *<input name="amount" type="number" min="0" step="any" required value="${f("amount")}"></label>
    <label>Premium Term (Years)<input name="term" type="number" min="0" step="1" value="${f("term")}"></label>
    <label>Payout Mode<select name="payoutMode">${opts(LISTS.PAYOUT_MODES, e.payoutMode || "Automatic")}</select></label>
    <label>Manual Payout Override<input name="manualOverride" type="number" min="0" step="any" value="${f("manualOverride")}"></label>
    <label>Status<select name="status">${opts(LISTS.BUSINESS_STATUS, e.status || "Lead")}</select></label>
    <label>Follow-up Date<input name="followUp" type="date" value="${f("followUp")}"></label>
    <label>Payment Date<input name="paymentDate" type="date" value="${f("paymentDate")}"></label>
    <label class="wide">Document Link<input name="docLink" placeholder="Link to a restricted folder (avoid uploading PAN cards)" value="${f("docLink")}"></label>
    <label class="wide">Notes<textarea name="notes" rows="2">${f("notes")}</textarea></label>
    <p class="hint wide" style="grid-column:1/-1;margin:0">Commission rate and auto payout are looked up from Commission Rates by product + company. A manual override, when entered, becomes the final payout.</p>
    <div class="actions"><button class="btn">${e.id ? "Update Business Login" : "Save Business Login"}</button>${e.id ? '<button type="button" id="cancel" class="btn ghost">Cancel</button>' : ""}</div>
  </form>
  <h3 style="margin-top:28px">Search Business Logins</h3>
  <div class="bar"><input id="q" placeholder="Search by Login ID, Partner ID, Partner or Customer"></div><div id="res"></div>`;
  bindForm(v, "businesses");
  if (!D) { $("#res", v).innerHTML = gateHTML("Searching existing business logins shows stored data."); bindGate(v); return; }
  bindSearch("businesses", v);
  const q = search.businesses.trim().toLowerCase();
  $("#res", v).innerHTML = q ? table(bizCols, D.businesses.filter((b) => [b.id, b.partnerId, b.partnerName, b.customer].some((x) => String(x).toLowerCase().includes(q))), rowBtns("businesses")) : `<p class="hint">Type to search existing cases.</p>`;
}

function businesses(v) {
  const statuses = LISTS.BUSINESS_STATUS;
  v.innerHTML = `<div class="bar"><input id="q" placeholder="Filter by partner, company, month, status, product…"></div><div id="res"></div>`;
  bindSearch("businesses", v);
  $("#res", v).innerHTML = table(bizCols, D.businesses.filter((b) => matches(b, search.businesses)), rowBtns("businesses"));
}

// ---------- Commission rates ----------
function rates(v) {
  const e = editing?.kind === "rates" ? D.rates.find((r) => r.id === editing.id) : {};
  const f = (k, d = "") => esc(e[k] ?? d);
  v.innerHTML = `<h3>${e.id ? "Edit " + esc(e.id) : "Commission Rate Setup"}</h3>
  <form class="f">
    <label>Product *<select name="product" required>${opts(LISTS.PRODUCTS, e.product)}</select></label>
    <label>Company *<input name="company" required value="${f("company")}"></label>
    <label>Commission Rate (%) *<input name="rate" type="number" min="0" max="100" step="any" required value="${e.rate !== undefined ? +(e.rate * 100).toFixed(6) : ""}"></label>
    <label>Effective From<input name="effectiveFrom" type="date" value="${f("effectiveFrom")}"></label>
    <label>Effective To<input name="effectiveTo" type="date" value="${f("effectiveTo")}"></label>
    <label>Notes<input name="notes" value="${f("notes")}"></label>
    <div class="actions"><button class="btn">${e.id ? "Update Rate" : "Save Rate"}</button>${e.id ? '<button type="button" id="cancel" class="btn ghost">Cancel</button>' : ""}</div>
  </form>
  <h3 style="margin-top:28px">Rates</h3>
  ${table([{ k: "product", h: "Product" }, { k: "company", h: "Company" }, { h: "Rate", n: 1, f: (r) => +(r.rate * 100).toFixed(6) + "%" }, { k: "effectiveFrom", h: "From" }, { k: "effectiveTo", h: "To" }, { k: "notes", h: "Notes" }], D.rates, rowBtns("rates"))}`;
  bindForm(v, "rates");
}

// ---------- Follow-ups (derived from business logins) ----------
function followups(v) {
  const rows = D.businesses.filter((b) => b.followUp).map((b) => ({ ...b, days: overdueDays(b) })).sort((a, b) => a.followUp.localeCompare(b.followUp));
  v.innerHTML = `<div class="bar"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="openOnly" checked style="width:auto"> Hide Paid / Rejected</label></div><div id="res"></div>`;
  const draw = () => {
    const list = $("#openOnly", v).checked ? rows.filter(isOpen) : rows;
    $("#res", v).innerHTML = table([{ k: "id", h: "Login ID" }, { k: "partnerId", h: "Partner ID" }, { k: "partnerName", h: "Partner" }, { k: "customer", h: "Customer" }, { k: "product", h: "Product" }, { k: "company", h: "Company" },
      { k: "followUp", h: "Follow-up" }, { k: "status", h: "Status" }, { k: "notes", h: "Notes" }, { h: "Days Overdue", n: 1, f: (b) => (b.days > 0 ? `<span class="over">${b.days}</span>` : b.days) }], list);
  };
  $("#openOnly", v).onchange = draw; draw();
}

if (pass) unlock().catch(() => { pass = ""; D = null; render(); }); else render();
