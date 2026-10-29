import { supabase, must } from "./supabase.js";
import { requireAdmin } from "./guard.js";
import { toast, confirmBox, openModal, loadMap, tiles, dot, nearest, telHref, esc, ago } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

await requireAdmin("rep");

const PAGE = 15;
const BUCKET = "Audio_url";
const $ = id => document.getElementById(id);
const items = new Map();
const branches = [];
const baseTitle = document.title;
let done = false;
let busy = false;
let fetched = 0;
let filter = "new";
let term = "";
let unread = 0;
let adminPos = null;
let soundOn = localStorage.getItem("hs_snd") !== "0";
let ac = null;

const KINDS = {
  order: ["fa-cart-shopping", "Order"],
  stock: ["fa-box-open", "No stock"],
  message: ["fa-message", "Message"]
};
const kindOf = k => (KINDS[k] ? k : "message");
const safeUrl = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");

const norm = r => ({
  ...r,
  createdAt: Number(r.created_at) || 0,
  branchName: r.branch_name,
  branchId: r.branch_id,
  audioUrl: safeUrl(r.audio_url)
});

const hav = (a, b) => {
  const R = 6371;
  const rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const fmtKm = n => (n < 10 ? n.toFixed(1) : String(Math.round(n))) + " km";
const fmtMin = m => (m < 60 ? m + " min" : Math.floor(m / 60) + "h " + (m % 60) + "m");
const waNum = p => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("234")) return d;
  if (d.startsWith("0")) return "234" + d.slice(1);
  return d;
};
const phonesOf = b => [b.phone, b.phone2, b.phone3].filter(Boolean);
const hasPos = r => typeof r.lat === "number" && typeof r.lng === "number";

function shopFor(r) {
  const byId = r.branchId ? branches.find(b => String(b.id) === String(r.branchId)) : null;
  if (byId) return { branch: byId, d: hasPos(r) ? hav(r, byId) : null };
  if (hasPos(r)) return nearest(r, branches);
  return null;
}

async function fetchPage() {
  const from = fetched;
  const rows = (must(await supabase.from("requests").select("*").order("created_at", { ascending: false }).range(from, from + PAGE - 1)) || []).map(norm);
  fetched += rows.length;
  if (rows.length < PAGE) done = true;
  return rows;
}

function passes(r) {
  const f = filter === "all" ? true
    : filter === "new" ? r.status !== "done"
    : filter === "done" ? r.status === "done"
    : filter === "voice" ? !!(r.audioUrl || r.voice)
    : kindOf(r.kind) === filter;
  if (!f) return false;
  if (!term) return true;
  return [r.name, r.phone, r.message, r.items, r.address, r.ip, r.branchName, r.ref].join(" ").toLowerCase().includes(term);
}

const row = (icon, text, copy) => `<div class="ar-row"><i class="fa-solid ${icon}"></i><span>${esc(text)}</span>${copy ? `<button class="cp" type="button" data-copy="${esc(copy)}" aria-label="Copy"><i class="fa-regular fa-copy"></i></button>` : ""}</div>`;

function cardHTML(r) {
  const k = kindOf(r.kind);
  const [icon, label] = KINDS[k];
  const has = hasPos(r);
  const sh = shopFor(r);
  const isDone = r.status === "done";
  const init = (String(r.name || "?").trim()[0] || "?").toUpperCase();
  const canMap = has || !!sh;
  const shopPhone = sh ? phonesOf(sh.branch)[0] : "";
  const when = new Date(r.createdAt).toLocaleString();
  const waText = encodeURIComponent("Hello " + (r.name || "") + ", this is Hamstore. We received your " + label.toLowerCase() + ".");
  return `<article class="ar-card ${k} ${isDone ? "done" : "new"}" data-id="${esc(r.id)}">
    <header class="ar-h">
      <span class="av">${esc(init)}</span>
      <div class="who"><h4>${esc(r.name)}</h4><a class="ph" href="${telHref(r.phone)}"><i class="fa-solid fa-phone"></i>${esc(r.phone)}</a></div>
      <div class="tags"><span class="kind ${k}"><i class="fa-solid ${icon}"></i>${label}</span><span class="stt ${isDone ? "d" : "n"}">${isDone ? "Done" : "New"}</span></div>
    </header>
    <p class="when"><i class="fa-regular fa-clock"></i><time class="ago" data-ts="${r.createdAt}" title="${esc(when)}">${esc(ago(r.createdAt))}</time><span>${esc(when)}</span>${r.ref ? `<b class="ref">${esc(r.ref)}</b>` : ""}</p>
    ${r.items ? `<p class="msg"><b>Items:</b> ${esc(r.items)}</p>` : ""}
    ${r.message ? `<p class="msg">${esc(r.message)}</p>` : ""}
    ${r.audioUrl ? `<div class="ar-audio"><i class="fa-solid fa-microphone-lines"></i><audio controls preload="none" src="${esc(r.audioUrl)}"></audio><a class="dl" href="${esc(r.audioUrl)}" target="_blank" rel="noopener" download aria-label="Download"><i class="fa-solid fa-download"></i></a></div>` : ""}
    <div class="ar-rows">
      ${r.address ? row("fa-location-dot", r.address, r.address) : ""}
      ${has ? row("fa-crosshairs", r.lat.toFixed(5) + ", " + r.lng.toFixed(5), r.lat + "," + r.lng) : ""}
      ${r.ip ? row("fa-network-wired", r.ip, r.ip) : ""}
      ${r.branchName ? row("fa-store", "Sent from: " + r.branchName) : ""}
      ${sh && sh.d != null ? row("fa-route", (r.branchId ? "Branch: " : "Nearest shop: ") + sh.branch.name + " · " + fmtKm(sh.d)) : sh ? row("fa-store", sh.branch.name) : ""}
    </div>
    <div class="ar-acts">
      <a class="ab call" href="${telHref(r.phone)}"><i class="fa-solid fa-phone"></i>Call</a>
      <a class="ab wa" href="https://wa.me/${waNum(r.phone)}?text=${waText}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a>
      ${canMap ? '<button class="ab map" data-act="map" type="button"><i class="fa-solid fa-route"></i>Map and route</button>' : ""}
      ${shopPhone ? `<a class="ab" href="${telHref(shopPhone)}"><i class="fa-solid fa-store"></i>Call shop</a>` : ""}
      ${r.voice && !r.audioUrl ? '<button class="ab" data-act="voice" type="button"><i class="fa-solid fa-circle-play"></i>Voice</button>' : ""}
      <button class="ab ok" data-act="done" type="button"><i class="fa-solid ${isDone ? "fa-rotate-left" : "fa-check"}"></i>${isDone ? "Reopen" : "Done"}</button>
      <button class="ab del" data-act="del" type="button" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
    </div></article>`;
}

function updateCounts() {
  const n = { new: 0, order: 0, stock: 0, message: 0, done: 0, voice: 0, all: 0, today: 0 };
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  items.forEach(r => {
    n.all++;
    if (r.status === "done") n.done++; else n.new++;
    n[kindOf(r.kind)]++;
    if (r.audioUrl || r.voice) n.voice++;
    if (r.createdAt >= day.getTime()) n.today++;
  });
  $("filters").querySelectorAll(".chip").forEach(c => {
    const b = c.querySelector("b");
    if (b) b.textContent = n[c.dataset.f] ?? 0;
  });
  $("sNew").textContent = n.new;
  $("sToday").textContent = n.today;
  $("sVoice").textContent = n.voice;
  $("sOrder").textContent = n.order;
}

function emptyCheck() {
  $("empty").hidden = $("list").children.length > 0;
  $("more").hidden = done;
}

function render() {
  const list = [...items.values()].filter(passes).sort((a, b) => b.createdAt - a.createdAt);
  $("list").innerHTML = list.map(cardHTML).join("");
  updateCounts();
  emptyCheck();
}

function appendRows(rows) {
  const list = rows.filter(passes).sort((a, b) => b.createdAt - a.createdAt);
  $("list").insertAdjacentHTML("beforeend", list.map(cardHTML).join(""));
  updateCounts();
  emptyCheck();
}

const cardEl = id => $("list").querySelector(`[data-id="${CSS.escape(String(id))}"]`);

function upsertCard(r, isNew) {
  const el = cardEl(r.id);
  if (!passes(r)) { if (el) el.remove(); }
  else if (el) el.outerHTML = cardHTML(r);
  else if (isNew) {
    $("list").insertAdjacentHTML("afterbegin", cardHTML(r));
    $("list").firstElementChild.classList.add("fresh");
  }
  updateCounts();
  emptyCheck();
}

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

async function loadMore() {
  if (busy || done) return;
  busy = true;
  $("more").disabled = true;
  try {
    const rows = await fetchPage();
    rows.forEach(r => items.set(r.id, r));
    appendRows(rows);
  } catch (e) {
    toast("error", "Could not load requests", "Check your internet and try again.");
  } finally {
    busy = false;
    $("more").disabled = false;
  }
}
$("more").onclick = loadMore;
new IntersectionObserver(en => { if (en[0].isIntersecting) loadMore(); }, { rootMargin: "500px" }).observe($("more"));

const audioPath = u => {
  const m = /\/object\/public\/Audio_url\/(.+)$/.exec(u || "");
  return m ? decodeURIComponent(m[1].split("?")[0]) : "";
};

async function osrm(a, b) {
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`);
    const j = await r.json();
    const rt = j.routes && j.routes[0];
    if (!rt) throw new Error("none");
    return { pts: rt.geometry.coordinates.map(c => [c[1], c[0]]), km: rt.distance / 1000, min: Math.max(1, Math.round(rt.duration / 60)), est: false };
  } catch (e) {
    const d = hav(a, b);
    return { pts: [[a.lat, a.lng], [b.lat, b.lng]], km: d, min: Math.max(1, Math.round((d / 30) * 60)), est: true };
  }
}

function getMe() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(adminPos);
    navigator.geolocation.getCurrentPosition(p => {
      adminPos = { lat: p.coords.latitude, lng: p.coords.longitude };
      res(adminPos);
    }, () => res(adminPos), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });
}

const popShop = b => `<div class="ar-pop">${safeUrl(b.image) ? `<img src="${esc(b.image)}" alt="">` : ""}<b>${esc(b.name)}</b><span>${esc(b.address || "")}</span>${phonesOf(b).map(p => `<a href="${telHref(p)}">${esc(p)}</a>`).join("")}</div>`;

function infoShop(b, d) {
  const ph = phonesOf(b);
  return `<div class="ar-info shop">
    ${safeUrl(b.image) ? `<img src="${esc(b.image)}" alt="${esc(b.name)}">` : ""}
    <div><span class="lbl">Shop</span><h4>${esc(b.name)}</h4>
    <p><i class="fa-solid fa-location-dot"></i>${esc(b.address || "")}</p>
    ${b.opens && b.closes ? `<p><i class="fa-regular fa-clock"></i>${esc(b.opens)} - ${esc(b.closes)}</p>` : ""}
    ${d != null ? `<p><i class="fa-solid fa-route"></i>${fmtKm(d)} from customer</p>` : ""}
    <div class="calls">${ph.map(p => `<a class="ab call" href="${telHref(p)}"><i class="fa-solid fa-phone"></i>${esc(p)}</a>`).join("")}</div></div></div>`;
}

function infoCust(r) {
  return `<div class="ar-info cust"><div><span class="lbl">Customer</span><h4>${esc(r.name)}</h4>
    <p><i class="fa-solid fa-phone"></i>${esc(r.phone)}</p>
    ${r.address ? `<p><i class="fa-solid fa-location-dot"></i>${esc(r.address)}</p>` : ""}
    <div class="calls"><a class="ab call" href="${telHref(r.phone)}"><i class="fa-solid fa-phone"></i>Call</a><a class="ab wa" href="https://wa.me/${waNum(r.phone)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a></div></div></div>`;
}

async function showRoute(r) {
  const sh = shopFor(r);
  const shop = sh ? sh.branch : null;
  const pts = {};
  if (hasPos(r)) pts.cust = { lat: r.lat, lng: r.lng };
  if (shop) pts.shop = { lat: shop.lat, lng: shop.lng };
  if (adminPos) pts.me = { ...adminPos };
  const box = document.createElement("div");
  box.className = "ar-mapmodal";
  box.innerHTML = `<h3>${esc(r.name)}</h3>
    <div class="ar-tabs" id="rt"></div>
    <div class="ar-st" id="rs"></div>
    <div class="map modalmap ar-mapbox" id="rm"></div>
    <div class="ar-infos">${hasPos(r) ? infoCust(r) : ""}${shop ? infoShop(shop, sh.d) : ""}</div>
    <div class="row"><a class="btn" id="rn" target="_blank" rel="noopener"><i class="fa-solid fa-diamond-turn-right"></i>Open in Google Maps</a><button class="ghost" id="rc" type="button">Close</button></div>`;
  const close = openModal(box);
  box.querySelector("#rc").onclick = close;
  const L = await loadMap();
  const first = pts.cust || pts.shop || pts.me;
  const map = L.map(box.querySelector("#rm"), { zoomControl: true }).setView([first.lat, first.lng], 14);
  tiles(L).addTo(map);
  let meMarker = null;
  let line = null;
  let anim = 0;
  let sel = "";
  let lastDraw = 0;
  if (pts.cust) L.marker([pts.cust.lat, pts.cust.lng], { icon: dot(L, "#e03a3a") }).addTo(map).bindPopup(`<b>${esc(r.name)}</b><br>${esc(r.address || r.phone)}`);
  if (pts.shop) L.marker([pts.shop.lat, pts.shop.lng], { icon: dot(L, "#2fb36d") }).addTo(map).bindPopup(popShop(shop), { minWidth: 200 }).openPopup();
  const setMe = () => {
    if (!pts.me) return;
    if (meMarker) meMarker.setLatLng([pts.me.lat, pts.me.lng]);
    else meMarker = L.marker([pts.me.lat, pts.me.lng], { icon: dot(L, "#2f7bff") }).addTo(map).bindTooltip("You are here");
  };
  const defs = () => {
    const d = [];
    if (pts.me && pts.cust) d.push(["mc", "Me → Customer", pts.me, pts.cust]);
    if (pts.me && pts.shop) d.push(["ms", "Me → Shop", pts.me, pts.shop]);
    if (pts.cust && pts.shop) d.push(["cs", "Customer → Shop", pts.cust, pts.shop]);
    return d;
  };
  const paintTabs = () => {
    const d = defs();
    box.querySelector("#rt").innerHTML = d.map(x => `<button type="button" class="${x[0] === sel ? "on" : ""}" data-k="${x[0]}">${x[1]}</button>`).join("");
  };
  const draw = async () => {
    const d = defs();
    const cur = d.find(x => x[0] === sel) || d[0];
    const st = box.querySelector("#rs");
    if (!cur) {
      st.innerHTML = `<div class="note"><i class="fa-solid fa-location-crosshairs"></i>Allow location access to see the route from where you are.</div>`;
      map.fitBounds(L.latLngBounds(Object.values(pts).map(p => [p.lat, p.lng])).pad(0.3), { maxZoom: 16 });
      return;
    }
    sel = cur[0];
    lastDraw = Date.now();
    paintTabs();
    st.innerHTML = `<div class="note"><i class="fa-solid fa-spinner fa-spin"></i>Finding the road...</div>`;
    const [, , a, b] = cur;
    box.querySelector("#rn").href = `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=driving`;
    const rt = await osrm(a, b);
    if (!box.isConnected || sel !== cur[0]) return;
    st.innerHTML = `<div><small>Distance</small><b>${fmtKm(rt.km)}</b></div><div><small>Drive time</small><b>${fmtMin(rt.min)}</b></div><div><small>Route</small><b>${rt.est ? "Straight line" : "By road"}</b></div>`;
    clearInterval(anim);
    if (line) map.removeLayer(line);
    line = L.polyline([], { color: "#ffd166", weight: 6, opacity: 0.95 }).addTo(map);
    const step = Math.max(1, Math.ceil(rt.pts.length / 60));
    let k = 0;
    anim = setInterval(() => {
      k = Math.min(rt.pts.length, k + step);
      line.setLatLngs(rt.pts.slice(0, k));
      if (k >= rt.pts.length) clearInterval(anim);
    }, 25);
    map.fitBounds(L.latLngBounds([[a.lat, a.lng], [b.lat, b.lng]]).pad(0.25));
  };
  box.querySelector("#rt").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    sel = b.dataset.k;
    draw();
  });
  setMe();
  await draw();
  setTimeout(() => map.invalidateSize(), 250);
  if (!pts.me) {
    const m = await getMe();
    if (m && box.isConnected) { pts.me = { ...m }; setMe(); sel = ""; await draw(); }
  }
  const wid = navigator.geolocation ? navigator.geolocation.watchPosition(p => {
    const np = { lat: p.coords.latitude, lng: p.coords.longitude };
    const moved = pts.me ? hav(pts.me, np) * 1000 : 1e9;
    pts.me = np;
    adminPos = np;
    setMe();
    if (moved > 60 && Date.now() - lastDraw > 15000 && sel.startsWith("m")) draw();
  }, () => {}, { enableHighAccuracy: true, maximumAge: 10000 }) : null;
  const guard = setInterval(() => {
    if (box.isConnected) return;
    clearInterval(guard);
    clearInterval(anim);
    if (wid !== null) navigator.geolocation.clearWatch(wid);
    map.remove();
  }, 1500);
}

async function playLegacy(r) {
  try {
    const v = must(await supabase.from("voices").select("data").eq("request_id", r.id).maybeSingle());
    if (!v || !v.data) return toast("error", "No voice note", "The voice note was not found.");
    const box = document.createElement("div");
    box.innerHTML = `<h3>${esc(r.name)}</h3><audio controls autoplay style="width:100%"></audio><div class="row" style="margin-top:12px"><button class="ghost" type="button">Close</button></div>`;
    box.querySelector("audio").src = v.data;
    const close = openModal(box);
    box.querySelector("button").onclick = close;
  } catch (err) {
    toast("error", "Could not load", "You may not have permission.");
  }
}

$("list").addEventListener("click", async e => {
  const cp = e.target.closest("[data-copy]");
  if (cp) {
    try { await navigator.clipboard.writeText(cp.dataset.copy); toast("success", "Copied", cp.dataset.copy); } catch (err) { toast("error", "Could not copy", ""); }
    return;
  }
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.closest(".ar-card").dataset.id;
  const r = items.get(id);
  if (!r) return;
  if (btn.dataset.act === "map") return showRoute(r);
  if (btn.dataset.act === "voice") return playLegacy(r);
  if (btn.dataset.act === "done") {
    const status = r.status === "done" ? "new" : "done";
    try {
      const rows = must(await supabase.from("requests").update({ status }).eq("id", id).select("id"));
      if (!rows || !rows.length) throw new Error("denied");
      r.status = status;
      upsertCard(r, false);
    } catch (err) {
      toast("error", "Could not update", "You may not have permission.");
    }
    return;
  }
  if (btn.dataset.act === "del") {
    if (!(await confirmBox({ title: "Delete this request?", text: "The voice note will be deleted too. This cannot be undone.", okText: "Delete", danger: true }))) return;
    try {
      const rows = must(await supabase.from("requests").delete().eq("id", id).select("id"));
      if (!rows || !rows.length) throw new Error("denied");
      const p = audioPath(r.audioUrl);
      if (p) { try { await supabase.storage.from(BUCKET).remove([p]); } catch (err) {} }
      items.delete(id);
      const el = cardEl(id);
      if (el) el.remove();
      updateCounts();
      emptyCheck();
      toast("success", "Deleted", "The request was removed.");
    } catch (err) {
      toast("error", "Could not delete", "You may not have permission.");
    }
  }
});

const csvCell = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
$("exportBtn").onclick = () => {
  const list = [...items.values()].filter(passes).sort((a, b) => b.createdAt - a.createdAt);
  if (!list.length) return toast("error", "Nothing to export", "");
  const head = ["Date", "Name", "Phone", "Type", "Status", "Items", "Message", "Address", "IP", "Latitude", "Longitude", "Branch", "Audio"];
  const lines = list.map(r => [new Date(r.createdAt).toISOString(), r.name, r.phone, kindOf(r.kind), r.status || "new", r.items, r.message, r.address, r.ip, r.lat, r.lng, r.branchName, r.audioUrl].map(csvCell).join(","));
  const blob = new Blob(["\ufeff" + [head.map(csvCell).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "hamstore-requests-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
};

function paintAlerts() {
  $("alerts").classList.toggle("on", soundOn);
  $("alerts").innerHTML = `<i class="fa-solid ${soundOn ? "fa-bell" : "fa-bell-slash"}"></i>Alerts`;
}
$("alerts").onclick = async () => {
  soundOn = !soundOn;
  localStorage.setItem("hs_snd", soundOn ? "1" : "0");
  paintAlerts();
  if (soundOn) {
    beep();
    if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch (e) {} }
  }
};
paintAlerts();

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

function bumpTitle() {
  if (!document.hidden) return;
  unread++;
  document.title = "(" + unread + ") " + baseTitle;
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { unread = 0; document.title = baseTitle; }
});
document.addEventListener("click", () => { if (ac && ac.state === "suspended") ac.resume(); }, { once: true });

setInterval(() => {
  document.querySelectorAll("time.ago").forEach(el => { el.textContent = ago(Number(el.dataset.ts)); });
}, 60000);

async function saveSetting(key, value) {
  const up = must(await supabase.from("settings").update({ value }).eq("key", key).select("key"));
  if (up && up.length) return;
  must(await supabase.from("settings").insert({ key, value }));
}

$("settings").onclick = async () => {
  const box = document.createElement("div");
  box.className = "ar-set";
  box.innerHTML = `<h3>Shop settings</h3>
    <label class="ar-sw"><input id="swOpen" type="checkbox"><span></span><b>Online buying is open</b></label>
    <p class="hint">Turn this off and the website shows prices only. Customers are sent to a branch.</p>
    <div class="field"><i class="fa-solid fa-bullhorn lead"></i><input id="promo" type="text" maxlength="140" placeholder="Promo message on the website ticker"></div>
    <div class="row"><button class="btn" id="promoSave" type="button"><i class="fa-solid fa-floppy-disk"></i>Save promo</button></div>
    <h3 style="margin-top:22px">Contact numbers</h3><p class="hint">These numbers show on the website so people can call.</p><div id="phones"></div>
    <div class="field"><i class="fa-solid fa-tag lead"></i><input id="pLabel" type="text" maxlength="40" placeholder="Label, for example Sales"></div>
    <div class="field"><i class="fa-solid fa-phone lead"></i><input id="pNum" type="tel" placeholder="Phone number"></div>
    <div class="row"><button class="ghost" id="pClose" type="button">Close</button><button class="btn" id="pAdd" type="button"><i class="fa-solid fa-plus"></i>Save number</button></div>`;
  const close = openModal(box);
  box.querySelector("#pClose").onclick = close;
  try {
    const rows = must(await supabase.from("settings").select("key,value").in("key", ["shop_open", "promo_text"])) || [];
    const m = Object.fromEntries(rows.map(x => [x.key, x.value]));
    box.querySelector("#swOpen").checked = m.shop_open !== "no";
    box.querySelector("#promo").value = m.promo_text || "";
  } catch (err) {
    box.querySelector("#swOpen").checked = true;
  }
  box.querySelector("#swOpen").onchange = async ev => {
    const on = ev.target.checked;
    try {
      await saveSetting("shop_open", on ? "yes" : "no");
      toast("success", on ? "Shop is open" : "Shop is closed", on ? "Customers can order online." : "Customers see prices only.");
    } catch (err) {
      ev.target.checked = !on;
      toast("error", "Could not save", "You may not have permission.");
    }
  };
  box.querySelector("#promoSave").onclick = async () => {
    try {
      await saveSetting("promo_text", box.querySelector("#promo").value.trim());
      toast("success", "Saved", "The promo message was updated.");
    } catch (err) {
      toast("error", "Could not save", "You may not have permission.");
    }
  };
  const holder = box.querySelector("#phones");
  const draw = async () => {
    let rows = [];
    try {
      rows = must(await supabase.from("phones").select("*").order("created_at", { ascending: true })) || [];
    } catch (err) {
      toast("error", "Could not load numbers", "Check your internet and try again.");
    }
    holder.innerHTML = "";
    rows.forEach(v => {
      const el = document.createElement("div");
      el.className = "ph";
      el.innerHTML = `<span><b></b><br><span class="meta"></span></span><button class="ibtn del" type="button" aria-label="Remove"><i class="fa-solid fa-trash"></i></button>`;
      el.querySelector("b").textContent = v.label;
      el.querySelector(".meta").textContent = v.number;
      el.querySelector("button").onclick = async () => {
        if (!(await confirmBox({ title: "Remove this number?", text: v.number, okText: "Remove", danger: true }))) return;
        try {
          const del = must(await supabase.from("phones").delete().eq("id", v.id).select("id"));
          if (!del || !del.length) throw new Error("denied");
          draw();
        } catch (err) {
          toast("error", "Could not remove", "You may not have permission.");
        }
      };
      holder.appendChild(el);
    });
  };
  await draw();
  box.querySelector("#pAdd").onclick = async () => {
    const label = box.querySelector("#pLabel").value.trim();
    const number = box.querySelector("#pNum").value.trim();
    if (!label || !/^[0-9+\s-]{7,20}$/.test(number)) return toast("error", "Check details", "Enter a label and a valid number.");
    try {
      must(await supabase.from("phones").insert({ label, number }));
      box.querySelector("#pLabel").value = "";
      box.querySelector("#pNum").value = "";
      toast("success", "Saved", number + " was added.");
      draw();
    } catch (err) {
      toast("error", "Could not save", "You may not have permission.");
    }
  };
};

showLoading("Loading requests...");
try {
  const rows = must(await supabase.from("branches").select("*").order("created_at", { ascending: false }).limit(200)) || [];
  rows.forEach(b => { if (typeof b.lat === "number" && typeof b.lng === "number") branches.push(b); });
} catch (e) {}
await loadMore();
hideLoading();
getMe();

supabase
  .channel("requests-live")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "requests" }, payload => {
    const row = payload.new;
    if (!row || items.has(row.id)) return;
    const r = norm(row);
    items.set(r.id, r);
    fetched++;
    upsertCard(r, true);
    beep();
    bumpTitle();
    const label = KINDS[kindOf(r.kind)][1];
    toast("success", "New " + label.toLowerCase(), r.name + " · " + r.phone, 8000);
    if (document.hidden && "Notification" in window && Notification.permission === "granted" && soundOn) {
      try { new Notification("Hamstore: new " + label.toLowerCase(), { body: r.name + " · " + r.phone, icon: "https://i.imgur.com/UXH5q5w.png" }); } catch (e) {}
    }
  })
  .on("postgres_changes", { event: "UPDATE", schema: "public", table: "requests" }, payload => {
    const row = payload.new;
    const cur = row && items.get(row.id);
    if (!cur) return;
    Object.assign(cur, norm(row));
    upsertCard(cur, false);
  })
  .on("postgres_changes", { event: "DELETE", schema: "public", table: "requests" }, payload => {
    const id = payload.old && payload.old.id;
    if (!id || !items.has(id)) return;
    items.delete(id);
    const el = cardEl(id);
    if (el) el.remove();
    updateCounts();
    emptyCheck();
  })
  .subscribe();
