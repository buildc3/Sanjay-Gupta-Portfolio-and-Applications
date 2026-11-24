const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => (n == null || n === "" ? "" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const qty = (n) => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 6 });
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

let pass = sessionStorage.getItem("pm-pass") || ""; // same key as the other apps: unlock once
let S = null;       // { lots, sales, available }
let mode = null;    // "buy" | "sale" | "cash" | "net" | null

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

$("#buyBtn").onclick = () => { mode = mode === "buy" ? null : "buy"; renderPanel(); };
$("#saleBtn").onclick = () => { mode = mode === "sale" ? null : "sale"; renderPanel(); };
$("#cashBtn").onclick = () => { mode = mode === "cash" ? null : "cash"; renderPanel(); };
$("#netBtn").onclick = () => { mode = mode === "net" ? null : "net"; renderPanel(); };
$("#q").oninput = renderLots;

async function remove(path, id, what) {
  if (!confirm(`Delete ${what}? This cannot be undone.`)) return;
  try {
    const r = await api(path, "POST", { id });
    S = await api(""); render();
    sheetNote(r.sheets, `Deleted ${id}`);
  } catch (err) { toast(err.message, true); }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-del]"); if (!b) return;
  remove(b.dataset.del === "lot" ? "/delete-buy" : "/delete-sale", b.dataset.id, (b.dataset.del === "lot" ? "purchase " : "sale ") + b.dataset.id);
});
const delBtn = (kind) => (r) => `<button class="btn sm danger" data-del="${kind}" data-id="${esc(r.id)}" title="Delete">Delete</button>`;

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

function renderMoney() {
  const m = S.summary;
  $("#cashBtn").innerHTML = `Cash: <b class="${m.cash < 0 ? "over" : ""}">${inr(m.cash)}</b>`;
  $("#netBtn").innerHTML = `Net Worth: <b class="${m.netWorth < 0 ? "over" : ""}">${inr(m.netWorth)}</b>`;
  $("#cashBtn").classList.toggle("ghost", mode !== "cash"); $("#netBtn").classList.toggle("ghost", mode !== "net");
}

function render() { renderMoney(); renderPanel(); renderKpis(); renderLots(); renderSales(); }

function renderKpis() {
  const inStock = S.lots.reduce((s, l) => s + l.remaining, 0);
  const value = S.lots.reduce((s, l) => s + l.remaining * l.purchasePrice, 0);
  const profit = S.sales.reduce((s, x) => s + x.profit, 0);
  const k = (l, v) => `<div class="kpi"><small>${l}</small><b>${v}</b></div>`;
  $("#kpis").innerHTML = k("ARTICLES IN STOCK", S.available.length) + k("UNITS IN STOCK", qty(inStock)) + k("STOCK VALUE (AT COST)", inr(value)) + k("TOTAL SALES", inr(S.sales.reduce((s, x) => s + x.saleTotal, 0))) + k("PROFIT / LOSS", `<span class="${profit < 0 ? "over" : ""}">${inr(profit)}</span>`);
}

function renderLots() {
  const q = $("#q").value.trim().toLowerCase();
  const rows = S.lots.filter((l) => !q || l.article.toLowerCase().includes(q));
  $("#lotCount").textContent = rows.length;
  $("#lots").innerHTML = table([
    { k: "id", h: "Lot" }, { k: "article", h: "Name of Article" }, { h: "Quantity", n: 1, f: (l) => qty(l.quantity) }, { h: "Purchase Price", n: 1, f: (l) => inr(l.purchasePrice) },
    { k: "date", h: "Date" }, { h: "Sold", n: 1, f: (l) => qty(l.sold) },
    { h: "Available", n: 1, f: (l) => `<b class="${l.remaining === 0 ? "hint" : ""}">${qty(l.remaining)}</b>` },
    { h: "", f: delBtn("lot") },
  ], rows);
}

function renderSales() {
  $("#saleCount").textContent = S.sales.length;
  $("#sales").innerHTML = table([
    { k: "id", h: "Sale" }, { k: "article", h: "Name of Article" }, { h: "Quantity", n: 1, f: (x) => qty(x.quantity) }, { h: "Sale Price", n: 1, f: (x) => inr(x.salePrice) },
    { k: "date", h: "Date" }, { h: "Cost", n: 1, f: (x) => inr(x.costTotal) }, { h: "Sale Total", n: 1, f: (x) => inr(x.saleTotal) },
    { h: "Profit / Loss", n: 1, f: (x) => `<span class="${x.profit < 0 ? "over" : ""}">${inr(x.profit)}</span>` },
    { h: "From lots", f: (x) => esc(x.allocations.map((a) => `${a.lotId}×${qty(a.quantity)}`).join(", ")) },
    { h: "", f: delBtn("sale") },
  ], S.sales);
}

function renderPanel() {
  $("#buyBtn").classList.toggle("ghost", mode !== "buy"); $("#saleBtn").classList.toggle("ghost", mode !== "sale");
  renderMoney();
  const p = $("#panel");
  if (!mode) { p.innerHTML = ""; return; }

  const row = (l, v, cls = "") => `<div style="display:flex;justify-content:space-between;gap:24px;padding:4px 0"><span>${l}</span><b class="${cls}">${v}</b></div>`;
  if (mode === "net") {
    const m = S.summary;
    p.innerHTML = `<div class="card" style="max-width:420px"><h3 style="margin-top:0">Net Worth</h3>
      ${row("Cash in hand", inr(m.cash), m.cash < 0 ? "over" : "")}${row("Invested in stock (at cost)", inr(m.invested))}
      <hr style="border:0;border-top:1px solid var(--line);margin:8px 0">${row("Net Worth", inr(m.netWorth), m.netWorth < 0 ? "over" : "")}</div>`;
    return;
  }
  if (mode === "cash") {
    const m = S.summary;
    p.innerHTML = `<div class="card" style="max-width:420px"><h3 style="margin-top:0">Cash in hand</h3>
      ${row("Opening cash", inr(m.openingCash))}${row("− Spent on purchases", inr(m.purchases))}${row("+ Received from sales", inr(m.salesTotal))}
      <hr style="border:0;border-top:1px solid var(--line);margin:8px 0">${row("Cash balance", inr(m.cash), m.cash < 0 ? "over" : "")}
      <form id="form" class="f" style="margin-top:12px"><label>Opening cash<input name="openingCash" type="number" step="any" required value="${m.openingCash}"></label>
      <div class="actions"><button class="btn">Update opening cash</button></div></form></div>`;
    $("#form").onsubmit = async (e) => {
      e.preventDefault();
      try { await api("/cash", "POST", Object.fromEntries(new FormData(e.target))); S = await api(""); render(); toast("Opening cash updated"); }
      catch (err) { toast(err.message, true); }
    };
    return;
  }

  if (mode === "buy") {
    const known = [...new Set(S.lots.map((l) => l.article))];
    p.innerHTML = `<form class="f" id="form"><h3 style="grid-column:1/-1;margin:0">Buy: add stock to the register</h3>
      <label>Name of Article *<input name="article" required list="known" autocomplete="off" autofocus><datalist id="known">${known.map((a) => `<option value="${esc(a)}">`).join("")}</datalist></label>
      <label>Quantity *<input name="quantity" type="number" min="0" step="any" required></label>
      <label>Purchase Price (per unit) *<input name="purchasePrice" type="number" min="0" step="any" required></label>
      <label>Date *<input name="date" type="date" required value="${today()}"></label>
      <div class="actions"><button class="btn">Add to stock</button><span class="hint" id="note"></span></div></form>`;
    $("#form").oninput = () => { const f = new FormData($("#form")); const t = Number(f.get("quantity")) * Number(f.get("purchasePrice")); $("#note").textContent = t > 0 ? `Total cost ${inr(t)}` : ""; };
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
      note.innerHTML = f.salePrice === "" ? `Cost ${inr(cost)}` : `Sale ${inr(total)} · Cost ${inr(cost)} · <b class="${total - cost < 0 ? "over" : ""}">${total - cost < 0 ? "Loss" : "Profit"} ${inr(Math.abs(total - cost))}</b>`;
    };
  }

  $("#form").onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target)); const btn = $("button.btn", e.target); btn.disabled = true;
    try {
      const r = await api(mode === "buy" ? "/buy" : "/sell", "POST", body);
      S = await api(""); const m = mode; mode = null; render();
      sheetNote(r.sheets, m === "buy" ? `Added ${r.lot.id}` : `Sale ${r.sale.id} recorded (profit ${inr(r.sale.profit)})`);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  };
}

if (pass) unlock().catch(() => {});
