const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => (n == null || n === "" ? "" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const qty = (n) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 6 });
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

let pass = sessionStorage.getItem("pm-pass") || ""; // same key as the other apps: unlock once
let S = null;       // { lots, sales, available }
let mode = null;    // "buy" | "sale" | "bank" | null

function toast(msg, err) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : "");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hide"), err ? 6000 : 3500);
}

async function api(path, method = "GET", body) {
  const res = await fetch("/api/stock" + path, { method, headers: { "x-passcode": pass, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { sessionStorage.removeItem("pm-pass"); pass = ""; S = null; $("#app").classList.add("hide"); $("#lock").classList.remove("hide"); throw new Error("Wrong passcode"); }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function unlock() {
  S = await api("");
  $("#lock").classList.add("hide"); $("#app").classList.remove("hide");
  const b = $("#sheetsBadge"); b.textContent = S.googleSheets ? "Google Sheets sync on" : "Google Sheets sync off"; b.style.color = S.googleSheets ? "var(--accent2)" : "var(--warn)";
  render();
}
$("#lockForm").addEventListener("submit", async (e) => {
  e.preventDefault(); pass = $("#pass").value;
  try { await unlock(); sessionStorage.setItem("pm-pass", pass); } catch (err) { toast(err.message, true); }
});

// Nothing can be bought or sold until the bank balance has been set once.
const toggle = (m) => () => { mode = !S.bank.set ? "bank" : mode === m ? null : m; renderPanel(); };
$("#buyBtn").onclick = toggle("buy");
$("#saleBtn").onclick = toggle("sale");
$("#bankBtn").onclick = toggle("bank");
$("#q").oninput = renderLots;

function sheetNote(s, what) {
  if (s?.skipped) toast(`${what}. Saved to Netlify Blobs (Google Sheets not connected).`);
  else if (s?.ok) toast(`${what}. Saved to Netlify Blobs and Google Sheets.`);
  else toast(`${what} in Netlify Blobs, but Google Sheets failed: ${s?.error || "unknown"}`, true);
}

function table(cols, rows) {
  if (!rows.length) return `<p class="hint">No records yet.</p>`;
  return `<div class="tablewrap"><table><thead><tr>${cols.map((c) => `<th class="${c.n ? "n" : ""}">${c.h}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${cols.map((c) => `<td class="${c.n ? "n" : ""}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function render() { if (!S.bank.set) mode = "bank"; renderPanel(); renderKpis(); renderLots(); renderBank(); renderSales(); }

function renderKpis() {
  const inStock = S.lots.reduce((s, l) => s + l.remaining, 0);
  const value = S.lots.reduce((s, l) => s + l.remaining * l.purchasePrice, 0);
  const profit = S.sales.reduce((s, x) => s + x.profit, 0);
  const k = (l, v) => `<div class="kpi"><small>${l}</small><b>${v}</b></div>`;
  $("#kpis").innerHTML = k("BANK BALANCE", S.bank.set ? `<span class="${S.bank.balance < 0 ? "over" : ""}">${inr(S.bank.balance)}</span>` : `<span class="hint">Not set</span>`) + k("ARTICLES IN STOCK", S.available.length) + k("UNITS IN STOCK", qty(inStock)) + k("STOCK VALUE (AT COST)", inr(value)) + k("TOTAL SALES", inr(S.sales.reduce((s, x) => s + x.saleTotal, 0))) + k("PROFIT / LOSS", `<span class="${profit < 0 ? "over" : ""}">${inr(profit)}</span>`);
}

function renderLots() {
  const q = $("#q").value.trim().toLowerCase();
  const rows = S.lots.filter((l) => !q || l.article.toLowerCase().includes(q));
  $("#lotCount").textContent = rows.length;
  $("#lots").innerHTML = table([
    { k: "id", h: "Lot" }, { k: "article", h: "Name of Article" }, { h: "Quantity", n: 1, f: (l) => qty(l.quantity) }, { h: "Purchase Price", n: 1, f: (l) => inr(l.purchasePrice) },
    { k: "date", h: "Date" }, { h: "Sold", n: 1, f: (l) => qty(l.sold) },
    { h: "Available", n: 1, f: (l) => `<b class="${l.remaining === 0 ? "hint" : ""}">${qty(l.remaining)}</b>` },
  ], rows);
}

const TYPES = { opening: "Opening balance", adjust: "Adjustment", buy: "Purchase", sale: "Sale" };
function renderBank() {
  $("#bankCount").textContent = S.bank.entries.length;
  $("#bank").innerHTML = table([
    { k: "id", h: "Entry" }, { k: "date", h: "Date" }, { h: "Type", f: (e) => TYPES[e.type] || esc(e.type) }, { k: "ref", h: "Ref" }, { k: "note", h: "Details" },
    { h: "Amount", n: 1, f: (e) => `<span class="${e.amount < 0 ? "over" : ""}">${e.amount < 0 ? "−" : "+"}${inr(Math.abs(e.amount))}</span>` },
    { h: "Balance", n: 1, f: (e) => `<b>${inr(e.balanceAfter)}</b>` },
  ], S.bank.entries);
}

function renderSales() {
  $("#saleCount").textContent = S.sales.length;
  $("#sales").innerHTML = table([
    { k: "id", h: "Sale" }, { k: "article", h: "Name of Article" }, { h: "Quantity", n: 1, f: (x) => qty(x.quantity) }, { h: "Sale Price", n: 1, f: (x) => inr(x.salePrice) },
    { k: "date", h: "Date" }, { h: "Cost", n: 1, f: (x) => inr(x.costTotal) }, { h: "Sale Total", n: 1, f: (x) => inr(x.saleTotal) },
    { h: "Profit / Loss", n: 1, f: (x) => `<span class="${x.profit < 0 ? "over" : ""}">${inr(x.profit)}</span>` },
    { h: "From lots", f: (x) => esc(x.allocations.map((a) => `${a.lotId}×${qty(a.quantity)}`).join(", ")) },
  ], S.sales);
}

function renderPanel() {
  $("#bankBtn").classList.toggle("ghost", mode !== "bank"); $("#buyBtn").classList.toggle("ghost", mode !== "buy"); $("#saleBtn").classList.toggle("ghost", mode !== "sale");
  const p = $("#panel");
  if (!mode) { p.innerHTML = ""; return; }

  if (mode === "bank") {
    const first = !S.bank.set;
    p.innerHTML = `<form class="f" id="form"><h3 style="grid-column:1/-1;margin:0">${first ? "Set your bank balance to get started" : "Update bank balance"}</h3>
      <p class="hint" style="grid-column:1/-1;margin:0">${first ? "Enter the amount currently in your bank account. Every purchase will be deducted from it and every sale added to it." : `Current balance is ${inr(S.bank.balance)}. Enter the correct balance and the difference is recorded as an adjustment.`}</p>
      <label>${first ? "Bank balance (₹)" : "Correct balance (₹)"} *<input name="balance" type="number" step="any" required value="${first ? "" : S.bank.balance}" autofocus></label>
      <label>Date<input name="date" type="date" value="${today()}"></label>
      <label>Note<input name="note" placeholder="${first ? "Opening balance" : "e.g. Cash deposit"}"></label>
      <div class="actions"><button class="btn">${first ? "Save balance" : "Update balance"}</button><span class="hint" id="note"></span></div></form>`;
    if (!first) $("#form").oninput = () => { const v = Number(new FormData($("#form")).get("balance")); const d = v - S.bank.balance; $("#note").textContent = d ? `${d > 0 ? "+" : "−"}${inr(Math.abs(d))} adjustment` : ""; };
  } else if (mode === "buy") {
    const known = [...new Set(S.lots.map((l) => l.article))];
    p.innerHTML = `<form class="f" id="form"><h3 style="grid-column:1/-1;margin:0">Buy: add stock to the register</h3>
      <label>Name of Article *<input name="article" required list="known" autocomplete="off" autofocus><datalist id="known">${known.map((a) => `<option value="${esc(a)}">`).join("")}</datalist></label>
      <label>Quantity *<input name="quantity" type="number" min="0" step="any" required></label>
      <label>Purchase Price (per unit) *<input name="purchasePrice" type="number" min="0" step="any" required></label>
      <label>Date *<input name="date" type="date" required value="${today()}"></label>
      <div class="actions"><button class="btn">Add to stock</button><span class="hint" id="note"></span></div></form>`;
    $("#form").oninput = () => {
      const f = new FormData($("#form")); const t = Number(f.get("quantity")) * Number(f.get("purchasePrice")); const after = S.bank.balance - t;
      $("#note").innerHTML = t > 0 ? `Total cost ${inr(t)} · Bank after <b class="${after < 0 ? "over" : ""}">${inr(after)}</b>${after < 0 ? " (not enough balance)" : ""}` : `Bank balance ${inr(S.bank.balance)}`;
    };
    $("#note").textContent = `Bank balance ${inr(S.bank.balance)}`;
  } else {
    if (!S.available.length) { p.innerHTML = `<div class="card"><p style="margin:0">No stock available to sell. Use <b>Buy</b> to add stock first.</p></div>`; return; }
    p.innerHTML = `<form class="f" id="form"><h3 style="grid-column:1/-1;margin:0">Sale: sell from available stock</h3>
      <label>Name of Article *<select name="article" required><option value="">Select article…</option>${S.available.map((a) => `<option value="${esc(a.article)}">${esc(a.article)} (${qty(a.quantity)} available)</option>`).join("")}</select></label>
      <label>Quantity *<input name="quantity" type="number" min="0" step="any" required></label>
      <label>Sale Price (per unit) *<input name="salePrice" type="number" min="0" step="any" required></label>
      <label>Date *<input name="date" type="date" required value="${today()}"></label>
      <div class="actions"><button class="btn sale">Record sale</button><span class="hint" id="note"></span></div></form>`;
    $("#form").oninput = () => {
      const f = Object.fromEntries(new FormData($("#form"))); const note = $("#note");
      const av = S.available.find((a) => a.article === f.article);
      if (!av || !(Number(f.quantity) > 0)) { note.textContent = av ? `${qty(av.quantity)} available` : ""; return; }
      if (Number(f.quantity) > av.quantity) { note.innerHTML = `<span class="over">Only ${qty(av.quantity)} available</span>`; return; }
      // FIFO preview, same rule the server applies
      let left = Number(f.quantity), cost = 0;
      for (const l of S.lots.filter((l) => l.article === av.article && l.remaining > 0)) { const t = Math.min(left, l.remaining); cost += t * l.purchasePrice; left -= t; if (left <= 0) break; }
      const total = Number(f.quantity) * Number(f.salePrice || 0);
      note.innerHTML = f.salePrice === "" ? `Cost ${inr(cost)}` : `Sale ${inr(total)} · Cost ${inr(cost)} · <b class="${total - cost < 0 ? "over" : ""}">${total - cost < 0 ? "Loss" : "Profit"} ${inr(Math.abs(total - cost))}</b> · Bank after <b>${inr(S.bank.balance + total)}</b>`;
    };
  }

  $("#form").onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target)); const btn = $("button.btn", e.target); btn.disabled = true;
    try {
      const r = await api(`/${mode === "buy" ? "buy" : mode === "sale" ? "sell" : "bank"}`, "POST", body);
      S = await api(""); const m = mode; mode = null; render();
      sheetNote(r.sheets, m === "buy" ? `Added ${r.lot.id}, bank now ${inr(S.bank.balance)}` : m === "sale" ? `Sale ${r.sale.id} recorded (profit ${inr(r.sale.profit)}), bank now ${inr(S.bank.balance)}` : `Bank balance is ${inr(S.bank.balance)}`);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
}

if (pass) unlock().catch(() => {});
