// Shared header: Home + "My Applications" dropdown (Partner Management, My Data)
const path = location.pathname.replace(/\/$/, "") || "/";
const items = [["/applications/partner-management", "Partner Management", "Partners, business logins, payouts"], ["/my-data", "My Data", "All stored records in one place"]];
const inApps = path === "/applications" || items.some(([h]) => h === path);
const el = document.createElement("header");
el.className = "site";
el.innerHTML = `<div class="wrap"><a class="brand" href="/"><span class="logo">SG</span>Sanjay Gupta</a>
<nav><a href="/" class="${path === "/" ? "on" : ""}">Home</a>
<div class="dd"><a href="/applications" class="ddbtn ${inApps ? "on" : ""}" aria-haspopup="true" aria-expanded="false">My Applications <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></a>
<div class="ddmenu" role="menu">${items.map(([h, t, d]) => `<a role="menuitem" href="${h}" class="${h === path ? "on" : ""}"><b>${t}</b><small>${d}</small></a>`).join("")}</div></div></nav></div>`;
document.body.prepend(el);
const dd = el.querySelector(".dd"), btn = el.querySelector(".ddbtn");
// Touch / keyboard: first tap opens the menu instead of navigating
btn.addEventListener("click", (e) => {
  if (matchMedia("(hover: none)").matches && !dd.classList.contains("open")) { e.preventDefault(); dd.classList.add("open"); btn.setAttribute("aria-expanded", "true"); }
});
document.addEventListener("click", (e) => { if (!dd.contains(e.target)) { dd.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") dd.classList.remove("open"); });
