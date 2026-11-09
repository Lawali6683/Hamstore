import { supabase } from "./supabase.js";
import { toast, km, esc, ago } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

const $ = id => document.getElementById(id);
const MOVING_EVERY = 15000;
const STOPPED_EVERY = 60000;

const read = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const confirmed = read("hs_confirmed") === "1" && !!read("hs_vid") && !!read("hs_vkey");

let watchId = null;
let wakeLock = null;
let running = false;
let waitingFix = false;
let lastSent = 0;
let lastPoint = null;
let sent = 0;
let fails = 0;
let battery = null;
let rows = [];
let openId = null;

const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const safeUrl = u => (/^https:\/\//i.test(String(u || "")) ? String(u) : "");
const telLink = p => "tel:" + String(p || "").replace(/[^\d+]/g, "");
const waNum = p => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("234")) return d;
  if (d.startsWith("0")) return "234" + d.slice(1);
  return d;
};

if (navigator.getBattery) {
  navigator.getBattery().then(b => {
    battery = Math.round(b.level * 100);
    b.addEventListener("levelchange", () => { battery = Math.round(b.level * 100); });
  }).catch(() => {});
}

function paint(speed, accuracy) {
  $("liveDot").classList.toggle("on", running);
  $("liveTxt").textContent = running ? "Tracking is on" : "Not tracking";
  $("toggle").classList.toggle("red", running);
  $("toggle").innerHTML = running
    ? '<i class="fa-solid fa-stop"></i><span>Stop tracking</span>'
    : '<i class="fa-solid fa-play"></i><span>Start tracking</span>';
  if (typeof speed === "number") $("sSpeed").textContent = Math.round(speed) + " km/h";
  if (typeof accuracy === "number") $("sAcc").textContent = Math.round(accuracy) + " m";
  $("sCount").textContent = sent;
  $("sLast").textContent = lastSent ? new Date(lastSent).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
}

function speedOf(pos) {
  const c = pos.coords;
  if (typeof c.speed === "number" && !Number.isNaN(c.speed)) return c.speed * 3.6;
  if (!lastPoint) return 0;
  const dist = km(lastPoint, { lat: c.latitude, lng: c.longitude });
  const hours = (pos.timestamp - lastPoint.t) / 3600000;
  if (dist < 0.02 || hours <= 0) return 0;
  return Math.min(200, dist / hours);
}

async function send(lat, lng, speed, heading) {
  const body = { id: read("hs_vid"), key: read("hs_vkey"), lat, lng, speed };
  if (typeof heading === "number" && !Number.isNaN(heading)) body.head = heading;
  if (battery !== null) body.bat = battery;
  const res = await fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true
  });
  if (res.status === 401) return "denied";
  if (!res.ok) throw new Error("send");
  return "ok";
}

async function onPosition(pos) {
  if (waitingFix) { waitingFix = false; hideLoading(); }
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const speed = speedOf(pos);
  lastPoint = { lat, lng, t: pos.timestamp };
  paint(speed, pos.coords.accuracy);

  const wait = speed >= 3 ? MOVING_EVERY : STOPPED_EVERY;
  if (Date.now() - lastSent < wait) return;
  lastSent = Date.now();

  try {
    const result = await send(lat, lng, speed, pos.coords.heading);
    if (result === "denied") {
      stop();
      return toast("error", "Vehicle not recognised", "Confirm this phone again with the link we sent.");
    }
    sent++;
    fails = 0;
    paint(speed, pos.coords.accuracy);
  } catch (e) {
    fails++;
    if (fails === 3) toast("error", "No connection", "Still trying. Keep the page open.");
  }
}

function onError(err) {
  if (waitingFix) { waitingFix = false; hideLoading(); }
  if (err.code === 1) {
    stop();
    toast("error", "Location blocked", "Allow location for this site in your browser settings.");
  } else if (err.code === 2) {
    toast("error", "No GPS signal", "Move to an open area. We will keep trying.");
  }
}

async function keepAwake() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch (e) {}
}

function start() {
  if (!confirmed) return toast("error", "Not confirmed", "Open the link from your message to confirm this phone.");
  if (!navigator.geolocation) return toast("error", "Not supported", "This phone cannot share its location.");
  running = true;
  waitingFix = true;
  lastSent = 0;
  lastPoint = null;
  sent = 0;
  fails = 0;
  showLoading("Getting GPS signal...");
  watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  keepAwake();
  paint();
}

function stop() {
  running = false;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  if (waitingFix) { waitingFix = false; hideLoading(); }
  paint();
}

document.addEventListener("visibilitychange", () => {
  if (running && document.visibilityState === "visible") keepAwake();
});

window.addEventListener("beforeunload", e => {
  if (running) { e.preventDefault(); e.returnValue = ""; }
});

function initMine() {
  $("mine").hidden = false;
  $("vName").textContent = read("hs_vname") || read("hs_vid");
  $("vCode").textContent = read("hs_vcode") || read("hs_vid");
  $("sub").textContent = "This phone is confirmed. Tracking starts on its own.";
  $("toggle").onclick = () => (running ? stop() : start());
  $("forget").onclick = () => {
    stop();
    ["hs_vid", "hs_vkey", "hs_vname", "hs_vcode", "hs_confirmed"].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    location.reload();
  };
  paint();
  start();
}

function photosOf(v) {
  const p = v.photos && typeof v.photos === "object" ? v.photos : {};
  return [["vehicle", "Vehicle"], ["plate", "Plate number"], ["driver", "Driver"], ["id", "ID card"]]
    .map(([k, l]) => ({ k, l, u: safeUrl(p[k]) }))
    .filter(x => x.u);
}

function coverOf(v) {
  const ph = photosOf(v);
  return ((ph.find(x => x.k === "vehicle") || ph[0]) || {}).u || "";
}

function haystack(v) {
  return norm([v.name, v.driver_name, v.plate, v.code, v.phone, v.phone2, v.email, v.router_id, v.vehicle_type].join(" "));
}

function renderList() {
  const q = norm($("q").value);
  const list = q ? rows.filter(v => haystack(v).includes(q)) : rows;
  $("list").innerHTML = list.map(v => {
    const img = coverOf(v);
    const seen = v.last_ts ? ago(Number(v.last_ts)) : "Not seen yet";
    return `<button class="vcard" type="button" data-id="${esc(v.id)}">
      <span class="vthumb">${img ? `<img loading="lazy" src="${esc(img)}" alt="">` : '<i class="fa-solid fa-truck"></i>'}</span>
      <span class="vbody"><b>${esc(v.driver_name || v.name)}</b><small>${esc(v.name)} · ${esc(v.plate || "")}</small><small>${esc(v.code)} · ${esc(seen)}</small></span>
      <span class="vstat ${v.confirmed_at ? "ok" : "wait"}">${v.confirmed_at ? "Confirmed" : "Waiting"}</span>
    </button>`;
  }).join("");
  $("listMsg").textContent = list.length ? `${list.length} found` : (rows.length ? "No match for this search." : "No vehicles yet.");
}

async function loadDirectory() {
  $("listMsg").textContent = "Loading...";
  try {
    const { data, error } = await supabase.rpc("admin_vehicle_directory");
    if (error) throw error;
    if (!data || !data.ok) {
      rows = [];
      $("list").innerHTML = "";
      $("listMsg").innerHTML = 'Only the admin can see the directory. Sign in on the <a href="admin.html">admin page</a> first, then come back to this page.';
      return;
    }
    rows = data.vehicles || [];
    renderList();
  } catch (e) {
    rows = [];
    $("list").innerHTML = "";
    $("listMsg").textContent = "Could not load the directory. Check your internet and try again.";
  }
}

function openDetail(v) {
  openId = v.id;
  const ph = photosOf(v);
  const gallery = ph.length
    ? `<div class="gal">${ph.map((p, i) => `<button type="button" class="gimg" data-view="${i}"><img loading="lazy" src="${esc(p.u)}" alt=""><span>${esc(p.l)}</span></button>`).join("")}</div>`
    : '<p class="nophoto">No photos saved for this vehicle.</p>';
  const hasLoc = v.last_lat !== null && v.last_lat !== undefined && v.last_lng !== null && v.last_lng !== undefined;
  const seen = v.last_ts ? `${esc(new Date(Number(v.last_ts)).toLocaleString("en-NG"))}${v.last_speed !== null && v.last_speed !== undefined ? " · " + Math.round(Number(v.last_speed)) + " km/h" : ""}` : "Not seen yet";
  const row = (label, value) => `<div><dt>${esc(label)}</dt><dd>${value || "-"}</dd></div>`;
  $("detailBody").innerHTML = `
    <div class="dh">
      <h2 id="detailTitle">${esc(v.driver_name || v.name)}</h2>
      <p>${esc(v.name)}${v.plate ? " · " + esc(v.plate) : ""}</p>
    </div>
    ${gallery}
    <dl class="info">
      ${row("Vehicle ID", esc(v.code))}
      ${row("Plate", esc(v.plate))}
      ${row("Type", esc(v.vehicle_type))}
      ${row("Router ID", esc(v.router_id))}
      ${row("Driver phone", esc(v.phone))}
      ${row("Second phone", esc(v.phone2))}
      ${row("Email", esc(v.email))}
      ${row("Status", v.confirmed_at ? "Confirmed " + esc(ago(Number(v.confirmed_at))) : "Waiting for driver to confirm")}
      ${row("Last seen", seen)}
    </dl>
    <div class="acts">
      ${v.phone ? `<a class="act call" href="${telLink(v.phone)}"><i class="fa-solid fa-phone"></i>Call</a>` : ""}
      ${v.phone ? `<a class="act wa" target="_blank" rel="noopener" href="https://wa.me/${waNum(v.phone)}"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a>` : ""}
      ${v.email ? `<a class="act mail" href="mailto:${esc(v.email)}"><i class="fa-solid fa-envelope"></i>Email</a>` : ""}
      ${hasLoc ? `<a class="act map" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${Number(v.last_lat)},${Number(v.last_lng)}"><i class="fa-solid fa-map-location-dot"></i>Last location</a>` : ""}
    </div>`;
  $("detail").hidden = false;
  document.body.classList.add("lock");
  $("detail").querySelector(".sheet").scrollTop = 0;
}

function closeDetail() {
  $("detail").hidden = true;
  $("detailBody").innerHTML = "";
  openId = null;
  document.body.classList.remove("lock");
}

function openViewer(src) {
  $("viewerImg").src = src;
  $("viewer").hidden = false;
}

function closeViewer() {
  $("viewer").hidden = true;
  $("viewerImg").src = "";
}

$("q").addEventListener("input", renderList);

$("list").addEventListener("click", e => {
  const b = e.target.closest(".vcard");
  if (!b) return;
  const v = rows.find(z => String(z.id) === b.dataset.id);
  if (v) openDetail(v);
});

$("detailBody").addEventListener("click", e => {
  const g = e.target.closest("[data-view]");
  if (!g) return;
  const v = rows.find(z => String(z.id) === String(openId));
  const p = v ? photosOf(v)[Number(g.dataset.view)] : null;
  if (p) openViewer(p.u);
});

$("closeDetail").onclick = closeDetail;
$("detail").addEventListener("click", e => { if (e.target === $("detail")) closeDetail(); });
$("viewerX").onclick = closeViewer;
$("viewer").addEventListener("click", e => { if (e.target === $("viewer")) closeViewer(); });
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("viewer").hidden) closeViewer();
  else if (!$("detail").hidden) closeDetail();
});

if (confirmed) initMine();
loadDirectory();
