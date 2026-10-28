const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = (n) => (n == null || n === "" ? "" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const pct = (r) => (r === "" || r == null ? "" : +(r * 100).toFixed(6) + "%");
let pass = sessionStorage.getItem("pm-pass") || "";
let D = null;

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.className = "toast err"; setTimeout(() => t.classList.add("hide"), 5000); }

async function load() {
  const res = await fetch("/api/data", { headers: { "x-passcode": pass } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { if (res.status === 401) sessionStorage.removeItem("pm-pass"); throw new Error(data.error || "Request failed"); }
  D = data;
}
async function unlock() {
  await load();
  $("#lock").classList.add("hide"); $("#app").classList.remove("hide"); render();
}
$("#lockForm").addEventListener("submit", async (e) => {
  e.preventDefault(); pass = $("#pass").value;
  try { await unlock(); sessionStorage.setItem("pm-pass", pass); } catch (err) { toast(err.message); }
});
$("#refresh").onclick = async () => { try { await load(); render(); } catch (err) { toast(err.message); } };
$("#q").oninput = render;

const link = (u) => (/^https?:\/\//i.test(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">Open</a>` : esc(u));
const SECTIONS = () => [
  ["Partners", D.partners, [["id", "Partner ID"], ["name", "Full Name"], ["phone", "Contact"], ["email", "Email"], ["address", "Address"], ["profession", "Profession"], ["pan", "PAN"], ["dob", "DOB"], ["joinDate", "Joined"], ["status", "Status"], ["followUp", "Follow-up"], ["remarks", "Remarks"]]],
  ["Business Logins", D.businesses, [["id", "Login ID"], ["partnerId", "Partner ID"], ["partnerName", "Partner"], ["customer", "Customer"], ["loginDate", "Login Date"], ["month", "Month"], ["product", "Product"], ["company", "Company"], ["amount", "Amount", inr], ["term", "Term (Yrs)"], ["payoutMode", "Mode"], ["commissionRate", "Rate", pct], ["manualOverride", "Manual", inr], ["autoPayout", "Auto Payout", inr], ["finalPayout", "Final Payout", inr], ["status", "Status"], ["followUp", "Follow-up"], ["paymentDate", "Paid On"], ["notes", "Notes"], ["docLink", "Document", link]]],
  ["Commission Rates", D.rates, [["id", "ID"], ["product", "Product"], ["company", "Company"], ["rate", "Rate", pct], ["effectiveFrom", "From"], ["effectiveTo", "To"], ["notes", "Notes"]]],
];

function render() {
  const q = $("#q").value.trim().toLowerCase();
  const sum = (k) => D.businesses.reduce((s, b) => s + (Number(b[k]) || 0), 0);
  const k = (l, v) => `<div class="kpi"><small>${l}</small><b>${v}</b></div>`;
  $("#kpis").innerHTML = k("PARTNERS", D.partners.length) + k("BUSINESS LOGINS", D.businesses.length) + k("COMMISSION RATES", D.rates.length) + k("TOTAL BUSINESS", inr(sum("amount"))) + k("FINAL PAYOUT", inr(sum("finalPayout")));
  $("#out").innerHTML = SECTIONS().map(([title, rows, cols]) => {
    const shown = rows.filter((r) => !q || Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(q)));
    const body = shown.length
      ? `<div class="tablewrap"><table><thead><tr>${cols.map(([, h]) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${shown
          .map((r) => `<tr>${cols.map(([key, , f]) => `<td>${f ? f(r[key]) : esc(r[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      : `<p class="hint">${rows.length ? "No matches." : "No records yet."}</p>`;
    return `<h3 style="margin-top:28px">${title} <span class="pill">${shown.length}</span></h3>${body}`;
  }).join("");
}

if (pass) unlock().catch(() => {});
