import { supabase, must } from "./supabase.js";
import { requireAdmin } from "./guard.js";
import { toast, openModal, loadMap, tiles, km, telHref, esc, ago } from "./allui.js";
import { liveMarker, savePoint, loadPoints, prunePoints, fmtDur, bearing } from "./ui2.js";
import { showLoading, hideLoading } from "./loading.js";

await requireAdmin("map");

const $ = id => document.getElementById(id);
const L = await loadMap();
const map = L.map("fmap").setView([9.0765, 7.3986], 6);
tiles(L).addTo(map);
setTimeout(() => map.invalidateSize(), 300);
prunePoints();

const vehicles = new Map();
const live = {};
const markers = new Map();
const lastTs = {};
const stopSince = {};
const heads = {};
let selected = null;
let tab = "live";
let follow = false;
let trail = null;
let fitted = false;

const isLive = id => !!live[id] && Date.now() - live[id].ts < 120000;

function stateOf(id) {
  if (!isLive(id)) return "offline";
  return live[id].speed >= 3 ? "moving" : "stopped";
}

const clock = ts => new Date(ts).toLocaleString("en-NG", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });

function statusText(id) {
  const t = live[id];
  if (!t) return "No signal yet";
  if (!isLive(id)) return "Offline since " + clock(t.ts) + ". Phone is off or has no signal.";
  if (t.speed >= 3) return "Moving, " + Math.round(t.speed) + " km/h";
  return "Stopped" + (stopSince[id] ? " for " + fmtDur(Date.now() - stopSince[id]) : "");
}

function counts() {
  const all = [...vehicles.keys()];
  const on = all.filter(isLive).length;
  $("nLive").textContent = on;
  $("nOff").textContent = all.length - on;
  $("nAll").textContent = all.length;
}

function drawList() {
  counts();
  const rows = [...vehicles.values()].filter(v => tab === "all" || (tab === "live" ? isLive(v.id) : !isLive(v.id)));
  $("empty").hidden = rows.length > 0;
  $("list").innerHTML = rows.map(v => {
    const s = stateOf(v.id);
    const t = live[v.id];
    return `<article class="panel vitem ${s === "moving" ? "live" : s === "stopped" ? "stopped" : ""} ${selected === v.id ? "sel" : ""}" data-id="${esc(v.id)}">
      <h4><span class="dotlive"></span>${esc(v.name)} <span class="meta">${esc(v.plate)}</span></h4>
      <p class="meta">${esc(statusText(v.id))}</p>
      ${t && t.bat != null ? `<p class="meta"><i class="fa-solid fa-battery-half"></i> ${t.bat}% &nbsp;·&nbsp; ${ago(t.ts)}</p>` : ""}
    </article>`;
  }).join("");
}

function drawDetail() {
  const box = $("detail");
  if (!selected || !vehicles.has(selected)) { box.hidden = true; return; }
  const v = vehicles.get(selected);
  const t = live[selected];
  const s = stateOf(selected);
  const speed = t ? Math.round(t.speed) : 0;
  box.hidden = false;
  box.innerHTML = `<div class="rh"><h3>${esc(v.name)} <span class="meta">${esc(v.plate)}</span></h3><span class="chipc ${s === "offline" ? "wait" : "ok"}">${s === "moving" ? "Moving" : s === "stopped" ? "Stopped" : "Offline"}</span></div>
    <div class="gauge"><b>${speed}</b><span class="meta">km/h</span></div>
    <div class="gbar"><i style="width:${Math.min(100, speed / 1.2)}%"></i></div>
    <p class="meta">${esc(statusText(selected))}${t && t.bat != null ? " Battery " + t.bat + "%." : ""}</p>
    ${v.driverName ? `<p class="meta"><i class="fa-solid fa-user"></i> ${esc(v.driverName)}${v.phone ? " · " + esc(v.phone) : ""}</p>` : ""}
    <div class="dact">
      <button class="btn sm ${follow ? "red" : ""}" type="button" data-act="follow"><i class="fa-solid fa-location-crosshairs"></i>${follow ? "Following" : "Follow"}</button>
      <button class="ghost sm" type="button" data-act="history"><i class="fa-solid fa-clock-rotate-left"></i>History</button>
      ${v.phone ? `<a class="ghost sm" href="${telHref(v.phone)}"><i class="fa-solid fa-phone"></i>Call driver</a>` : ""}
    </div>`;
}

function refreshMarker(id) {
  const m = markers.get(id);
  if (m) m.setState(stateOf(id), live[id] ? live[id].speed : 0, heads[id]);
}

function onTracking(id, t) {
  const prev = live[id];
  live[id] = t;
  const v = vehicles.get(id);
  if (!v) return;
  if (lastTs[id] !== t.ts) {
    lastTs[id] = t.ts;
    savePoint({ vid: id, lat: t.lat, lng: t.lng, speed: t.speed, ts: t.ts });
    if (selected === id && trail) trail.addLatLng([t.lat, t.lng]);
  }
  if (typeof t.head === "number") heads[id] = t.head;
  else if (prev && km(prev, t) > 0.005) heads[id] = bearing(prev, t);
  if (t.speed < 3) { if (!stopSince[id]) stopSince[id] = t.ts; } else delete stopSince[id];

  let m = markers.get(id);
  if (!m) {
    m = liveMarker(L, map, [t.lat, t.lng], () => select(id, false));
    markers.set(id, m);
  } else {
    m.moveTo(t.lat, t.lng);
  }
  m.marker.bindTooltip(`${v.name} (${v.plate})`);
  refreshMarker(id);
  if (selected === id && follow) map.panTo([t.lat, t.lng]);
}

async function select(id, fly = true) {
  selected = id;
  follow = false;
  drawList();
  drawDetail();
  if (trail) { map.removeLayer(trail); trail = null; }
  if (live[id] && fly) map.flyTo([live[id].lat, live[id].lng], 16);
  const pts = (await loadPoints(id)).filter(p => Date.now() - p.ts < 7200000).slice(-80).map(p => [p.lat, p.lng]);
  if (selected !== id) return;
  trail = L.polyline(pts, { color: "#e03a3a", weight: 4, opacity: 0.85 }).addTo(map);
}

$("list").addEventListener("click", e => {
  const card = e.target.closest(".vitem");
  if (card) select(card.dataset.id);
});

$("tabs").querySelectorAll(".chip").forEach(c => c.onclick = () => {
  tab = c.dataset.t;
  $("tabs").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === c));
  drawList();
});

$("detail").addEventListener("click", e => {
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "follow") {
    follow = !follow;
    if (follow && live[selected]) map.flyTo([live[selected].lat, live[selected].lng], 16);
    drawDetail();
  }
  if (act === "history") openHistory(selected);
});

async function openHistory(id) {
  const v = vehicles.get(id);
  showLoading("Loading history...");
  let points = [];
  try {
    const local = await loadPoints(id);
    let server = [];
    try {
      const rows = must(await supabase.from("trails").select("lat,lng,t").eq("vehicle_id", id).order("t", { ascending: false }).limit(1500)) || [];
      server = rows.map(r => ({ lat: r.lat, lng: r.lng, ts: Number(r.t) }));
    } catch (e) {}
    points = [...local, ...server].sort((a, b) => a.ts - b.ts).filter((p, i, a) => i === 0 || Math.abs(p.ts - a[i - 1].ts) > 3000);
    points.forEach((p, i) => {
      if (typeof p.speed === "number") return;
      const q = points[i - 1];
      const h = q ? (p.ts - q.ts) / 3600000 : 0;
      p.speed = q && h > 0 && h < 0.1 ? Math.min(160, km(q, p) / h) : 0;
    });
  } finally {
    hideLoading();
  }

  const box = document.createElement("div");
  box.className = "hist";
  box.innerHTML = `<h3>${esc(v.name)} history</h3>
    <div class="chips" id="hr"><button class="chip on" data-r="today">Today</button><button class="chip" data-r="yday">Yesterday</button><button class="chip" data-r="all">All</button></div>
    <div class="map" id="hmap"></div>
    <div class="hstats"><div><b id="hDist">0 km</b><small>Distance</small></div><div><b id="hMax">0 km/h</b><small>Top speed</small></div><div><b id="hDrive">0 min</b><small>Driving</small></div><div><b id="hStops">0</b><small>Stops</small></div></div>
    <div class="player"><button class="btn sm" id="hPlay" type="button"><i class="fa-solid fa-play"></i></button><input id="hSlide" type="range" min="0" max="0" value="0"><span class="tm" id="hTime">-</span></div>
    <div class="chips" id="hRate" style="margin-bottom:4px"><button class="chip on" data-x="1">1x</button><button class="chip" data-x="4">4x</button><button class="chip" data-x="16">16x</button></div>
    <p class="meta" id="hEmpty" hidden>No history for this period yet. History builds up while this page is open and from the vehicle trail.</p>
    <div class="row" style="margin-top:10px"><button class="ghost" id="hClose" type="button">Close</button></div>`;
  const close = openModal(box);
  box.parentElement.classList.add("wide");
  box.querySelector("#hClose").onclick = () => { clearInterval(timer); close(); };

  const hm = L.map(box.querySelector("#hmap")).setView([9.0765, 7.3986], 6);
  tiles(L).addTo(hm);
  const layer = L.layerGroup().addTo(hm);
  let sim = null;
  let list = [];
  let idx = 0;
  let timer = 0;
  let rate = 1;
  setTimeout(() => hm.invalidateSize(), 250);

  const flag = (color, icon) => L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 30], html: `<div class="flag" style="background:${color}"><i class="fa-solid ${icon}"></i></div>` });

  function range(r) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const today = d.getTime();
    if (r === "today") return points.filter(p => p.ts >= today);
    if (r === "yday") return points.filter(p => p.ts >= today - 86400000 && p.ts < today);
    return points;
  }

  function show(r) {
    clearInterval(timer);
    box.querySelector("#hPlay").innerHTML = '<i class="fa-solid fa-play"></i>';
    layer.clearLayers();
    sim = null;
    list = range(r);
    box.querySelector("#hEmpty").hidden = list.length > 0;
    box.querySelector("#hSlide").max = Math.max(0, list.length - 1);
    box.querySelector("#hSlide").value = 0;
    idx = 0;
    if (!list.length) {
      ["#hDist", "#hMax", "#hDrive", "#hStops"].forEach((s, i) => (box.querySelector(s).textContent = ["0 km", "0 km/h", "0 min", "0"][i]));
      box.querySelector("#hTime").textContent = "-";
      return;
    }
    let dist = 0, drive = 0, top = 0;
    const segs = [[list[0]]];
    for (let i = 1; i < list.length; i++) {
      const p = list[i];
      const q = list[i - 1];
      const gap = p.ts - q.ts;
      if (gap > 600000) {
        segs.push([p]);
        L.polyline([[q.lat, q.lng], [p.lat, p.lng]], { color: "#7d8f86", weight: 3, dashArray: "4 8" }).addTo(layer);
      } else {
        segs[segs.length - 1].push(p);
        dist += km(q, p);
        if (p.speed >= 3) drive += gap;
      }
      top = Math.max(top, p.speed);
    }
    segs.forEach(sg => L.polyline(sg.map(p => [p.lat, p.lng]), { color: "#e03a3a", weight: 4, opacity: 0.9 }).addTo(layer));

    let stops = 0;
    let run = null;
    const endRun = () => {
      if (run && run.last.ts - run.first.ts >= 180000) {
        stops++;
        L.marker([run.first.lat, run.first.lng], { icon: flag("#e08a1a", "fa-pause") }).addTo(layer).bindTooltip("Stopped " + fmtDur(run.last.ts - run.first.ts) + " at " + clock(run.first.ts));
      }
      run = null;
    };
    list.forEach((p, i) => {
      const brk = i > 0 && p.ts - list[i - 1].ts > 600000;
      if (brk) endRun();
      if (p.speed < 3) { if (!run) run = { first: p, last: p }; else run.last = p; } else endRun();
    });
    endRun();

    L.marker([list[0].lat, list[0].lng], { icon: flag("#2fb36d", "fa-flag") }).addTo(layer).bindTooltip("Start " + clock(list[0].ts));
    const end = list[list.length - 1];
    L.marker([end.lat, end.lng], { icon: flag("#e03a3a", "fa-location-dot") }).addTo(layer).bindTooltip("Last seen " + clock(end.ts));
    hm.fitBounds(L.latLngBounds(list.map(p => [p.lat, p.lng])).pad(0.2));

    box.querySelector("#hDist").textContent = dist.toFixed(1) + " km";
    box.querySelector("#hMax").textContent = Math.round(top) + " km/h";
    box.querySelector("#hDrive").textContent = fmtDur(drive);
    box.querySelector("#hStops").textContent = stops;
    sim = liveMarker(L, hm, [list[0].lat, list[0].lng]);
    place(0, false);
  }

  function place(i, animate = true) {
    idx = i;
    const p = list[i];
    if (!p) return;
    sim.moveTo(p.lat, p.lng, animate ? 250 : 1);
    const q = list[i - 1];
    sim.setState(p.speed >= 3 ? "moving" : "stopped", p.speed, q && km(q, p) > 0.003 ? bearing(q, p) : null);
    box.querySelector("#hSlide").value = i;
    box.querySelector("#hTime").textContent = new Date(p.ts).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" }) + " · " + Math.round(p.speed) + " km/h";
  }

  box.querySelector("#hr").querySelectorAll(".chip").forEach(c => c.onclick = () => {
    box.querySelector("#hr").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === c));
    show(c.dataset.r);
  });
  box.querySelector("#hRate").querySelectorAll(".chip").forEach(c => c.onclick = () => {
    rate = Number(c.dataset.x);
    box.querySelector("#hRate").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === c));
  });
  box.querySelector("#hSlide").oninput = e => { if (sim) place(Number(e.target.value), false); };
  box.querySelector("#hPlay").onclick = () => {
    if (!list.length) return;
    if (timer) {
      clearInterval(timer);
      timer = 0;
      box.querySelector("#hPlay").innerHTML = '<i class="fa-solid fa-play"></i>';
      return;
    }
    if (idx >= list.length - 1) place(0, false);
    box.querySelector("#hPlay").innerHTML = '<i class="fa-solid fa-pause"></i>';
    timer = setInterval(() => {
      if (!document.body.contains(box)) return clearInterval(timer);
      if (idx >= list.length - 1) {
        clearInterval(timer);
        timer = 0;
        box.querySelector("#hPlay").innerHTML = '<i class="fa-solid fa-play"></i>';
        return;
      }
      place(idx + 1);
    }, Math.max(40, 300 / rate));
  };

  show(range("today").length ? "today" : "all");
  if (!range("today").length) {
    box.querySelector("#hr").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x.dataset.r === "all"));
  }
}

/* ---------- SUPABASE: vehicles + tracking ---------- */
const normVehicle = r => ({ ...r, driverName: r.driver_name });
const normTracking = r => ({
  lat: Number(r.lat),
  lng: Number(r.lng),
  speed: Number(r.speed) || 0,
  head: typeof r.head === "number" ? r.head : null,
  bat: typeof r.bat === "number" ? r.bat : null,
  ts: Number(r.ts) || 0
});

function fitOnce() {
  if (!fitted && markers.size) {
    fitted = true;
    map.fitBounds(L.featureGroup([...markers.values()].map(m => m.marker)).getBounds().pad(0.3), { maxZoom: 15 });
  }
}

async function loadVehicles() {
  const rows = must(await supabase.from("vehicles").select("id,name,plate,driver_name,phone")) || [];
  const ids = new Set();
  rows.forEach(r => { ids.add(r.id); vehicles.set(r.id, normVehicle(r)); });
  [...vehicles.keys()].forEach(id => {
    if (ids.has(id)) return;
    vehicles.delete(id);
    if (markers.has(id)) { markers.get(id).remove(); markers.delete(id); }
  });
  Object.keys(live).forEach(id => { if (vehicles.has(id) && !markers.has(id)) onTracking(id, live[id]); });
  drawList();
  drawDetail();
}

async function loadTracking() {
  const rows = must(await supabase.from("tracking").select("*")) || [];
  rows.forEach(r => onTracking(r.vehicle_id, normTracking(r)));
  drawList();
  drawDetail();
  fitOnce();
}

showLoading("Loading fleet...");
try {
  await loadVehicles();
  await loadTracking();
} catch (e) {
  toast("error", "Could not load vehicles", "Check your internet and try again.");
}
hideLoading();

// Kai tsaye (Realtime)
supabase
  .channel("fleet-vehicles")
  .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => { loadVehicles().catch(() => {}); })
  .subscribe();

supabase
  .channel("fleet-tracking")
  .on("postgres_changes", { event: "*", schema: "public", table: "tracking" }, payload => {
    const r = payload.new;
    if (!r || !r.vehicle_id) return;
    onTracking(r.vehicle_id, normTracking(r));
    drawList();
    drawDetail();
    fitOnce();
  })
  .subscribe();

setInterval(() => {
  [...markers.keys()].forEach(refreshMarker);
  drawList();
  drawDetail();
}, 15000);
