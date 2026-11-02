import { supabase, must } from "./supabase.js";
import { requireAdmin } from "./guard.js";
import { toast, confirmBox, telHref, esc, ago } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";
import { openRouteMap } from "./hsmap.js";
import { downloadSlip } from "./slip.js";

await requireAdmin("rep");

const PAGE = 20;
const $ = id => document.getElementById(id);
const rows = new Map();
const baseTitle = document.title;
let done = false;
let busy = false;
let fetched = 0;
let filter = "pending";
let term = "";
let unread = 0;
let soundOn = localStorage.getItem("hs_snd") !== "0";
let ac = null;

const naira = n => "₦" + Math.round(Number(n) || 0).toLocaleString("en-US");
const safeUrl = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
const waNum = p => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("234")) return d;
  if (d.startsWith("0")) return "234" + d.slice(1);
  return d;
};
const hasPos = r => typeof r.lat === "number" && typeof r.lng === "number";

const norm = r => ({
  ...r,
  createdAt: Number(r.created_at) || 0,
  deliveredAt: Number(r.delivered_at) || 0,
  list: Array.isArray(r.items) ? r.items : []
});

async function fetchPage() {
  const from = fetched;
  const data = (must(await supabase.from("deliveries").select("*").order("created_at", { ascending: false }).range(from, from + PAGE - 1)) || []).map(norm);
  fetched += data.length;
  if (data.length < PAGE) done = true;
  return data;
}

function passes(r) {
  if (filter === "pending" && r.status !== "pending") return false;
  if (filter === "delivered" && r.status !== "delivered") return false;
  if (!term) return true;
  return [r.code, r.name, r.phone, r.driver, r.address].join(" ").toLowerCase().includes(term);
}

function cardHTML(r) {
  const isDone = r.status === "delivered";
  const pos = hasPos(r);
  const when = new Date(r.createdAt).toLocaleString();
  const proof = safeUrl(r.proof_url);
  const lines = r.list.map(i => `<div class="ar-row"><i class="fa-solid fa-box"></i><span>${esc(i.name)} × ${esc(i.qty)}</span><b>${esc(naira(i.line || (Number(i.price) || 0) * (Number(i.qty) || 0)))}</b></div>`).join("");
  return `<article class="ar-card ${isDone ? "done" : "order"}" data-id="${esc(r.code)}">
    <header class="ar-h">
      <span class="av"><i class="fa-solid ${isDone ? "fa-check" : "fa-truck-fast"}"></i></span>
      <div class="who"><h4>${esc(r.name || "Customer")}</h4>${r.phone ? `<a class="ph" href="${telHref(r.phone)}"><i class="fa-solid fa-phone"></i>${esc(r.phone)}</a>` : `<span class="ph">Phone removed</span>`}</div>
      <div class="tags"><span class="stt ${isDone ? "d" : "n"}">${isDone ? "Delivered" : "Pending"}</span></div>
    </header>
    <p class="when"><i class="fa-regular fa-clock"></i><time class="ago" data-ts="${r.createdAt}" title="${esc(when)}">${esc(ago(r.createdAt))}</time><span>${esc(when)}</span><b class="ref">${esc(r.code)}</b></p>
    <div class="ar-rows">${lines}</div>
    <div class="ar-sum"><span>Total</span><b>${esc(naira(r.total))}</b></div>
    ${r.address ? `<div class="ar-rows"><div class="ar-row"><i class="fa-solid fa-location-dot"></i><span>${esc(r.address)}</span><button class="cp" type="button" data-copy="${esc(r.address)}" aria-label="Copy"><i class="fa-regular fa-copy"></i></button></div></div>` : ""}
    ${proof ? `<a class="ar-proof" href="${esc(proof)}" target="_blank" rel="noopener"><img src="${esc(proof)}" alt="Payment proof" loading="lazy"><span><i class="fa-solid fa-receipt"></i>Payment proof</span></a>` : ""}
    ${isDone ? `<div class="ar-rows"><div class="ar-row"><i class="fa-solid fa-id-badge"></i><span>Driver: ${esc(r.driver || "-")}</span></div><div class="ar-row"><i class="fa-solid fa-check-double"></i><span>${esc(new Date(r.deliveredAt).toLocaleString())}</span></div>${r.note ? `<div class="ar-row"><i class="fa-solid fa-note-sticky"></i><span>${esc(r.note)}</span></div>` : ""}</div>` : ""}
    <div class="ar-acts">
      ${!isDone && r.phone ? `<a class="ab call" href="${telHref(r.phone)}"><i class="fa-solid fa-phone"></i>Call</a><a class="ab wa" href="https://wa.me/${waNum(r.phone)}?text=${encodeURIComponent("Hello " + (r.name || "") + ", this is Hamstore. Your order " + r.code + " is on the way. Give the code to the driver when goods arrive.")}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a>` : ""}
      ${!isDone && pos ? '<button class="ab route" data-act="map" type="button"><i class="fa-solid fa-route"></i>Map and route</button>' : ""}
      ${isDone && typeof r.delivered_lat === "number" ? '<button class="ab route" data-act="where" type="button"><i class="fa-solid fa-location-dot"></i>Delivered here</button>' : ""}
      ${!isDone ? '<button class="ab" data-act="slip" type="button"><i class="fa-solid fa-file-pdf"></i>Slip PDF</button>' : ""}
      <button class="ab" data-act="copycode" type="button"><i class="fa-regular fa-copy"></i>Code</button>
      <button class="ab del" data-act="del" type="button" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
    </div></article>`;
}

function counts() {
  let p = 0, d = 0, today = 0, val = 0;
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  rows.forEach(r => {
    if (r.status === "delivered") { d++; if (r.deliveredAt >= day.getTime()) today++; }
    else { p++; val += Number(r.total) || 0; }
  });
  $("sPend").textContent = p;
  $("sToday").textContent = today;
  $("sValue").textContent = naira(val);
  $("sAll").textContent = rows.size;
  $("filters").querySelectorAll(".chip").forEach(c => {
    const b = c.querySelector("b");
    if (b) b.textContent = c.dataset.f === "pending" ? p : c.dataset.f === "delivered" ? d : rows.size;
  });
}

function emptyCheck() {
  $("empty").hidden = $("list").children.length > 0;
  $("more").hidden = done;
}

function render() {
  const list = [...rows.values()].filter(passes).sort((a, b) => b.createdAt - a.createdAt);
  $("list").innerHTML = list.map(cardHTML).join("");
  counts();
  emptyCheck();
}

const cardEl = code => $("list").querySelector(`[data-id="${CSS.escape(String(code))}"]`);

function upsert(r, isNew) {
  const el = cardEl(r.code);
  if (!passes(r)) { if (el) el.remove(); }
  else if (el) el.outerHTML = cardHTML(r);
  else if (isNew) {
    $("list").insertAdjacentHTML("afterbegin", cardHTML(r));
    $("list").firstElementChild.classList.add("fresh");
  }
  counts();
  emptyCheck();
}

async function loadMore() {
  if (busy || done) return;
  busy = true;
  $("more").disabled = true;
  try {
    const data = await fetchPage();
    data.forEach(r => rows.set(r.code, r));
    const list = data.filter(passes).sort((a, b) => b.createdAt - a.createdAt);
    $("list").insertAdjacentHTML("beforeend", list.map(cardHTML).join(""));
    counts();
    emptyCheck();
  } catch (e) {
    toast("error", "Could not load deliveries", "Check your internet and try again.");
  } finally {
    busy = false;
    $("more").disabled = false;
  }
}
$("more").onclick = loadMore;
new IntersectionObserver(en => { if (en[0].isIntersecting) loadMore(); }, { rootMargin: "500px" }).observe($("more"));

$("filters").querySelectorAll(".chip").forEach(c => c.onclick = () => {
  filter = c.dataset.f;
  $("filters").querySelectorAll(".chip").forEach(z => z.classList.toggle("on", z === c));
  render();
});

let searchT = 0;
$("q").addEventListener("input", e => {
  clearTimeout(searchT);
  searchT = setTimeout(() => { term = e.target.value.trim().toLowerCase(); render(); }, 180);
});

$("list").addEventListener("click", async e => {
  const cp = e.target.closest("[data-copy]");
  if (cp) {
    try { await navigator.clipboard.writeText(cp.dataset.copy); toast("success", "Copied", cp.dataset.copy); } catch (err) { toast("error", "Could not copy", ""); }
    return;
  }
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const code = btn.closest(".ar-card").dataset.id;
  const r = rows.get(code);
  if (!r) return;
  const act = btn.dataset.act;
  if (act === "copycode") {
    try { await navigator.clipboard.writeText(r.code); toast("success", "Copied", r.code); } catch (err) {}
    return;
  }
  if (act === "map") {
    openRouteMap({ title: r.name, cust: { lat: r.lat, lng: r.lng, name: r.name, address: r.address, phone: r.phone } });
    return;
  }
  if (act === "where") {
    openRouteMap({ title: r.code, cust: { lat: r.delivered_lat, lng: r.delivered_lng, name: "Delivered here", address: r.driver ? "Driver: " + r.driver : "" } });
    return;
  }
  if (act === "slip") {
    showLoading("Preparing slip...");
    try {
      await downloadSlip({ code: r.code, name: r.name, phone: r.phone, address: r.address, createdAt: r.createdAt, total: r.total, items: r.list });
    } catch (err) {
      toast("error", "Could not make the slip", "");
    } finally {
      hideLoading();
    }
    return;
  }
  if (act === "del") {
    if (!(await confirmBox({ title: "Delete this delivery?", text: r.code + " will no longer open for the driver.", okText: "Delete", danger: true }))) return;
    try {
      const del = must(await supabase.from("deliveries").delete().eq("code", r.code).select("code"));
      if (!del || !del.length) throw new Error("denied");
      rows.delete(r.code);
      const el = cardEl(r.code);
      if (el) el.remove();
      counts();
      emptyCheck();
      toast("success", "Deleted", r.code);
    } catch (err) {
      toast("error", "Could not delete", "You may not have permission.");
    }
  }
});

function beep() {
  if (!soundOn) return;
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    if (ac.state === "suspended") ac.resume();
    const o = ac.createOscillator();
    const g = ac.createGain();
    const t = ac.currentTime;
    o.type = "sine";
    o.frequency.setValueAtTime(880, t);
    o.frequency.setValueAtTime(1175, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(t + 0.42);
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
  } catch (e) {}
}

function paintAlerts() {
  $("alerts").classList.toggle("on", soundOn);
  $("alerts").innerHTML = `<i class="fa-solid ${soundOn ? "fa-bell" : "fa-bell-slash"}"></i>Alerts`;
}
$("alerts").onclick = () => {
  soundOn = !soundOn;
  localStorage.setItem("hs_snd", soundOn ? "1" : "0");
  paintAlerts();
  if (soundOn) beep();
};
paintAlerts();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { unread = 0; document.title = baseTitle; }
});
document.addEventListener("click", () => { if (ac && ac.state === "suspended") ac.resume(); }, { once: true });
setInterval(() => {
  document.querySelectorAll("time.ago").forEach(el => { el.textContent = ago(Number(el.dataset.ts)); });
}, 60000);

let accs = [];

function renderAccs() {
  $("accCount").textContent = accs.length;
  $("noAcc").hidden = accs.some(a => String(a.number || "").trim());
  $("accList").innerHTML = accs.length
    ? accs.map(a => `<div class="ar-acc-row" data-id="${esc(a.id)}"><div><b>${esc(a.number)}</b><span>${esc(a.name)} · ${esc(a.bank)}</span></div><button class="ab" data-accact="copy" type="button" aria-label="Copy"><i class="fa-regular fa-copy"></i></button><button class="ab danger" data-accact="del" type="button" aria-label="Remove"><i class="fa-solid fa-trash"></i></button></div>`).join("")
    : '<p class="ar-empty">No account yet. Add one below.</p>';
}

async function loadAccs() {
  try {
    accs = must(await supabase.from("payment_accounts").select("*").order("created_at", { ascending: true })) || [];
  } catch (e) {
    accs = [];
    toast("error", "Could not load accounts", "Check your internet and try again.");
  }
  renderAccs();
}

$("accBtn").onclick = () => {
  $("accounts").scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => $("aBank").focus({ preventScroll: true }), 400);
};

$("accList").addEventListener("click", async e => {
  const b = e.target.closest("[data-accact]");
  if (!b) return;
  const id = b.closest(".ar-acc-row").dataset.id;
  const a = accs.find(z => String(z.id) === String(id));
  if (!a) return;
  if (b.dataset.accact === "copy") {
    try { await navigator.clipboard.writeText(a.number); toast("success", "Copied", a.number); } catch (err) {}
    return;
  }
  if (!(await confirmBox({ title: "Remove this account?", text: a.number + " · " + a.bank, okText: "Remove", danger: true }))) return;
  try {
    const del = must(await supabase.from("payment_accounts").delete().eq("id", a.id).select("id"));
    if (!del || !del.length) throw new Error("denied");
    toast("success", "Removed", a.number);
    loadAccs();
  } catch (err) {
    toast("error", "Could not remove", "Run hamstore_admin_fix.sql in Supabase if this keeps happening.");
  }
});

$("accForm").addEventListener("submit", async e => {
  e.preventDefault();
  const bank = $("aBank").value.trim();
  const name = $("aName").value.trim();
  const number = $("aNum").value.replace(/\s/g, "");
  if (bank.length < 2) return toast("error", "Bank name", "Enter the bank name.");
  if (name.length < 2) return toast("error", "Account name", "Enter the account name.");
  if (!/^[0-9]{6,20}$/.test(number)) return toast("error", "Account number", "Enter digits only, at least 6.");
  const btn = $("accForm").querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    must(await supabase.from("payment_accounts").insert({ bank, name, number }));
    $("aBank").value = "";
    $("aName").value = "";
    $("aNum").value = "";
    toast("success", "Saved", number + " was added.");
    await loadAccs();
  } catch (err) {
    toast("error", "Could not save", "Only an admin can add accounts. Run hamstore_admin_fix.sql in Supabase.");
  } finally {
    btn.disabled = false;
  }
});

showLoading("Loading deliveries...");
await loadMore();
await loadAccs();
hideLoading();

supabase
  .channel("deliveries-live")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "deliveries" }, payload => {
    const row = payload.new;
    if (!row || rows.has(row.code)) return;
    const r = norm(row);
    rows.set(r.code, r);
    fetched++;
    upsert(r, true);
    beep();
    if (document.hidden) { unread++; document.title = "(" + unread + ") " + baseTitle; }
    toast("success", "New order", r.code + " · " + naira(r.total), 8000);
  })
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "deliveries" }, payload => {
    const row = payload.new;
    const cur = row && rows.get(row.code);
    if (!cur) return;
    Object.assign(cur, norm(row));
    upsert(cur, false);
  })
  .on("postgres_changes", { event: "DELETE", schema: "public", table: "deliveries" }, payload => {
    const code = payload.old && payload.old.code;
    if (!code || !rows.has(code)) return;
    rows.delete(code);
    const el = cardEl(code);
    if (el) el.remove();
    counts();
    emptyCheck();
  })
  .subscribe();
