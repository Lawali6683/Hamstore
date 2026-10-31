const LJS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
const LCSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
const TILE = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const ATTR = "&copy; OpenStreetMap &copy; CARTO";

const T = {
  en: {
    close: "Close map", finding: "Finding the road...", you: "You are here", dist: "Distance", time: "Time", arrive: "Arrive",
    dir: "Directions", gm: "Open in Google Maps", fit: "Recenter", mc: "Me → Customer", ms: "Me → Shop", cs: "Customer → Shop",
    allow: "Allow location access to see the route from where you are.", cust: "Customer", shop: "Shop", call: "Call",
    road: "By road", line: "Straight line", left: "Turn left", right: "Turn right", sl: "Bear left", sr: "Bear right",
    shl: "Sharp left", shr: "Sharp right", straight: "Continue straight", uturn: "Make a U-turn", start: "Start driving",
    arrived: "You have arrived", round: "Enter the roundabout", onto: " onto ", on: " on ", away: "away"
  },
  ha: {
    close: "Rufe taswira", finding: "Ana neman hanya...", you: "Kana nan", dist: "Nisa", time: "Lokaci", arrive: "Isowa",
    dir: "Jagorar hanya", gm: "Buɗe a Google Maps", fit: "Koma tsakiya", mc: "Ni → Kwastoma", ms: "Ni → Shago", cs: "Kwastoma → Shago",
    allow: "Ka ba da izinin location don ganin hanya daga inda kake.", cust: "Kwastoma", shop: "Shago", call: "Kira",
    road: "Ta hanya", line: "Layi kai tsaye", left: "Ka juya hagu", right: "Ka juya dama", sl: "Ka karkata hagu kaɗan", sr: "Ka karkata dama kaɗan",
    shl: "Ka juya hagu sosai", shr: "Ka juya dama sosai", straight: "Ka ci gaba da tafiya", uturn: "Ka juya baya", start: "Ka fara tafiya",
    arrived: "Ka isa wurin", round: "Shiga zagaye", onto: " a ", on: " a ", away: "daga nan"
  }
};

const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = v => typeof v === "number" && Number.isFinite(v);
const valid = p => !!p && num(Number(p.lat)) && num(Number(p.lng)) && p.lat !== null && p.lng !== null && p.lat !== "" && p.lng !== "";
const tel = p => "tel:" + String(p || "").replace(/[^\d+]/g, "");
const waNum = p => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("234")) return d;
  if (d.startsWith("0")) return "234" + d.slice(1);
  return d;
};
const safeUrl = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
const fmtKm = n => (n < 10 ? n.toFixed(1) : String(Math.round(n))) + " km";
const fmtMin = m => (m < 60 ? m + " min" : Math.floor(m / 60) + "h " + (m % 60) + "m");
const fmtDist = d => (d < 1000 ? Math.max(10, Math.round(d / 10) * 10) + " m" : (d / 1000).toFixed(1) + " km");
const arriveAt = min => new Date(Date.now() + min * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const hav = (a, b) => {
  const rad = d => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

let lastMe = null;
let leafletP = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletP) return leafletP;
  leafletP = new Promise((res, rej) => {
    if (!document.querySelector(`link[href="${LCSS}"]`)) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = LCSS;
      document.head.appendChild(l);
    }
    const s = document.createElement("script");
    s.src = LJS;
    s.onload = () => res(window.L);
    s.onerror = () => { leafletP = null; rej(new Error("leaflet")); };
    document.head.appendChild(s);
  });
  return leafletP;
}

function ensureCss() {
  if (document.querySelector("link[data-hsm]")) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = new URL("./hsmap.css", import.meta.url).href;
  l.dataset.hsm = "1";
  document.head.appendChild(l);
}

async function osrm(a, b) {
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson&steps=true`);
    const j = await r.json();
    const rt = j.routes && j.routes[0];
    if (!rt) throw new Error("none");
    const steps = [];
    (rt.legs || []).forEach(l => (l.steps || []).forEach(s => steps.push({ m: s.maneuver || {}, name: s.name || "", d: s.distance || 0 })));
    return { pts: rt.geometry.coordinates.map(c => [c[1], c[0]]), km: rt.distance / 1000, min: Math.max(1, Math.round(rt.duration / 60)), steps, est: false };
  } catch (e) {
    const d = hav(a, b);
    return { pts: [[a.lat, a.lng], [b.lat, b.lng]], km: d, min: Math.max(1, Math.round((d / 30) * 60)), steps: [], est: true };
  }
}

function stepText(s, tx) {
  const type = s.m.type;
  const mod = s.m.modifier;
  const on = s.name ? tx.onto + s.name : "";
  if (type === "depart") return tx.start + (s.name ? tx.on + s.name : "");
  if (type === "arrive") return tx.arrived;
  if (type === "roundabout" || type === "rotary") return tx.round + on;
  const map = { left: tx.left, right: tx.right, "slight left": tx.sl, "slight right": tx.sr, "sharp left": tx.shl, "sharp right": tx.shr, straight: tx.straight, uturn: tx.uturn };
  return (mod && map[mod] ? map[mod] : tx.straight) + on;
}

function stepIcon(s) {
  const type = s.m.type;
  const mod = s.m.modifier || "";
  if (type === "arrive") return "fa-flag-checkered";
  if (type === "depart") return "fa-play";
  if (type === "roundabout" || type === "rotary") return "fa-arrows-rotate";
  if (mod === "uturn") return "fa-rotate-left";
  if (mod.includes("left")) return "fa-arrow-left";
  if (mod.includes("right")) return "fa-arrow-right";
  return "fa-arrow-up";
}

export async function openRouteMap(opts = {}) {
  const cust = valid(opts.cust) ? opts.cust : null;
  const shop = valid(opts.shop) ? opts.shop : null;
  if (!cust && !shop) return null;
  ensureCss();
  const lang = (opts.lang || document.documentElement.getAttribute("data-lang") || "en") === "ha" ? "ha" : "en";
  const s = T[lang];

  const custCard = c => `<div class="hsm-card"><i class="fa-solid fa-house-user"></i><div><span class="lbl">${s.cust}</span><h4>${esc(c.name)}</h4>${c.address ? `<p>${esc(c.address)}</p>` : ""}${c.phone ? `<div class="hsm-calls"><a class="hsm-b sm call" href="${tel(c.phone)}"><i class="fa-solid fa-phone"></i>${s.call}</a><a class="hsm-b sm wa" href="https://wa.me/${waNum(c.phone)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a></div>` : ""}</div></div>`;
  const shopPhones = c => (Array.isArray(c.phones) ? c.phones : [c.phone]).filter(Boolean);
  const shopCard = c => `<div class="hsm-card">${safeUrl(c.image) ? `<img src="${esc(c.image)}" alt="">` : '<i class="fa-solid fa-store"></i>'}<div><span class="lbl">${s.shop}</span><h4>${esc(c.name)}</h4>${c.address ? `<p>${esc(c.address)}</p>` : ""}<div class="hsm-calls">${shopPhones(c).map(p => `<a class="hsm-b sm call" href="${tel(p)}"><i class="fa-solid fa-phone"></i>${esc(p)}</a>`).join("")}</div></div></div>`;

  const root = document.createElement("div");
  root.className = "hsm";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.innerHTML = `<div class="hsm-map"></div>
    <button class="hsm-x" type="button" aria-label="${s.close}"><i class="fa-solid fa-xmark"></i></button>
    <div class="hsm-top"></div>
    <div class="hsm-wrap">
      <div class="hsm-ctl"><button class="hsm-mb" type="button" data-a="fit" aria-label="${s.fit}"><i class="fa-solid fa-location-crosshairs"></i></button></div>
      <div class="hsm-sheet">
        <button class="hsm-grab" type="button" aria-label="Expand"></button>
        <h3 class="hsm-title">${esc(opts.title || "")}</h3>
        <div class="hsm-tabs"></div>
        <div class="hsm-eta"><div><small>${s.dist}</small><b data-e="km">-</b></div><div><small>${s.time}</small><b data-e="min">-</b></div><div><small>${s.arrive}</small><b data-e="arr">-</b></div></div>
        <div class="hsm-cards">${cust ? custCard(cust) : ""}${shop ? shopCard(shop) : ""}</div>
        <div class="hsm-btns"><a class="hsm-b gm" target="_blank" rel="noopener"><i class="fa-solid fa-diamond-turn-right"></i>${s.gm}</a></div>
        <h5>${s.dir}</h5>
        <ol class="hsm-steps"></ol>
      </div>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add("hsm-lock");

  const q = sel => root.querySelector(sel);
  const top = q(".hsm-top");
  const sheet = q(".hsm-sheet");
  const tabsEl = q(".hsm-tabs");
  const stepsEl = q(".hsm-steps");
  const gm = q(".gm");
  const setEta = (a, b, c) => { q('[data-e="km"]').textContent = a; q('[data-e="min"]').textContent = b; q('[data-e="arr"]').textContent = c; };

  let closed = false;
  let pushed = false;
  let map = null;
  let wid = null;
  let anim = 0;
  let veh = 0;
  let sel = "";
  let lastDraw = 0;
  let drawTok = 0;
  let layers = [];
  let meMarker = null;

  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(anim);
    clearInterval(veh);
    if (wid !== null && navigator.geolocation) navigator.geolocation.clearWatch(wid);
    window.removeEventListener("popstate", onPop);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onSize);
    if (map) map.remove();
    root.remove();
    document.body.classList.remove("hsm-lock");
    if (pushed && history.state && history.state.hsm) history.back();
  };
  const onPop = () => { pushed = false; close(); };
  const onKey = e => { if (e.key === "Escape") close(); };
  const onSize = () => { if (map) setTimeout(() => map.invalidateSize(), 200); };
  window.addEventListener("popstate", onPop);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onSize);
  window.addEventListener("orientationchange", onSize);
  try { history.pushState({ hsm: 1 }, ""); pushed = true; } catch (e) {}
  try { screen.orientation.unlock(); } catch (e) {}
  q(".hsm-x").onclick = close;
  q(".hsm-grab").onclick = () => sheet.classList.toggle("open");

  let L;
  try {
    L = await loadLeaflet();
  } catch (e) {
    close();
    return null;
  }
  if (closed) return close;

  const pts = {};
  if (cust) pts.cust = { lat: Number(cust.lat), lng: Number(cust.lng) };
  if (shop) pts.shop = { lat: Number(shop.lat), lng: Number(shop.lng) };
  if (lastMe) pts.me = { ...lastMe };

  map = L.map(q(".hsm-map"), { zoomControl: false, tap: true, zoomSnap: 0.5 });
  L.control.zoom({ position: "topleft" }).addTo(map);
  L.tileLayer(TILE, { subdomains: "abcd", maxZoom: 20, attribution: ATTR }).addTo(map);
  const first = pts.cust || pts.shop;
  map.setView([first.lat, first.lng], 15);
  setTimeout(() => map.invalidateSize(), 300);

  const pinIcon = html => L.divIcon({ className: "", iconSize: [54, 66], iconAnchor: [27, 66], popupAnchor: [0, -62], html });
  if (pts.cust) L.marker([pts.cust.lat, pts.cust.lng], { icon: pinIcon('<div class="hsm-pin cust"><i class="fa-solid fa-house"></i></div>') }).addTo(map).bindPopup(`<b>${esc(cust.name || s.cust)}</b>${cust.address ? "<br>" + esc(cust.address) : ""}`);
  if (pts.shop) L.marker([pts.shop.lat, pts.shop.lng], { icon: pinIcon(`<div class="hsm-pin shop">${safeUrl(shop.image) ? `<img src="${esc(shop.image)}" alt="">` : '<i class="fa-solid fa-store"></i>'}</div>`) }).addTo(map).bindPopup(`<b>${esc(shop.name || s.shop)}</b>${shop.address ? "<br>" + esc(shop.address) : ""}`);

  const setMe = () => {
    if (!pts.me) return;
    if (meMarker) meMarker.setLatLng([pts.me.lat, pts.me.lng]);
    else meMarker = L.marker([pts.me.lat, pts.me.lng], { icon: L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="hsm-me"><i></i><b></b></div>' }), zIndexOffset: 500 }).addTo(map).bindTooltip(s.you);
  };

  const defs = () => {
    const d = [];
    if (pts.me && pts.cust) d.push(["mc", s.mc, pts.me, pts.cust]);
    if (pts.me && pts.shop) d.push(["ms", s.ms, pts.me, pts.shop]);
    if (pts.cust && pts.shop) d.push(["cs", s.cs, pts.cust, pts.shop]);
    return d;
  };

  const paintTabs = () => {
    const d = defs();
    tabsEl.hidden = d.length < 2;
    tabsEl.innerHTML = d.map(x => `<button type="button" class="${x[0] === sel ? "on" : ""}" data-k="${x[0]}">${x[1]}</button>`).join("");
  };

  const fitPad = () => {
    const side = matchMedia("(orientation:landscape) and (max-height:560px)").matches;
    return side
      ? { paddingTopLeft: [60, 70], paddingBottomRight: [Math.min(400, innerWidth * 0.46) + 30, 30] }
      : { paddingTopLeft: [30, 80], paddingBottomRight: [30, Math.round(innerHeight * 0.46)] };
  };

  let fitFn = () => {};

  const draw = async () => {
    const d = defs();
    const cur = d.find(x => x[0] === sel) || d[0];
    const dest = pts.cust || pts.shop;
    if (!cur) {
      top.textContent = s.allow;
      setEta("-", "-", "-");
      stepsEl.innerHTML = "";
      tabsEl.hidden = true;
      gm.href = `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=driving`;
      const b = L.latLngBounds(Object.values(pts).map(p => [p.lat, p.lng]));
      fitFn = () => (Object.keys(pts).length > 1 ? map.fitBounds(b.pad(0.3), fitPad()) : map.setView([dest.lat, dest.lng], 16));
      fitFn();
      return;
    }
    sel = cur[0];
    lastDraw = Date.now();
    paintTabs();
    top.textContent = s.finding;
    const a = cur[2];
    const b = cur[3];
    gm.href = `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=driving`;
    const tok = ++drawTok;
    const r = await osrm(a, b);
    if (closed || tok !== drawTok) return;
    top.textContent = `${fmtKm(r.km)} · ${fmtMin(r.min)} · ${r.est ? s.line : s.road}`;
    setEta(fmtKm(r.km), fmtMin(r.min), arriveAt(r.min));
    stepsEl.innerHTML = r.steps.map(x => `<li><i class="fa-solid ${stepIcon(x)}"></i><span>${esc(stepText(x, s))}</span><em>${x.m.type === "arrive" ? "" : fmtDist(x.d)}</em></li>`).join("");
    clearInterval(anim);
    clearInterval(veh);
    layers.forEach(l => map.removeLayer(l));
    const casing = L.polyline([], { color: "#fff", weight: 11, opacity: 0.95, lineCap: "round", lineJoin: "round" }).addTo(map);
    const line = L.polyline([], { color: "#1a73e8", weight: 7, opacity: 1, lineCap: "round", lineJoin: "round" }).addTo(map);
    const flow = L.polyline([], { color: "#fff", weight: 2.5, opacity: 0.9, dashArray: "2 14", className: "hsm-flow" }).addTo(map);
    layers = [casing, line, flow];
    const ll = r.pts;
    const inc = Math.max(1, Math.ceil(ll.length / 60));
    let k = 0;
    anim = setInterval(() => {
      k = Math.min(ll.length, k + inc);
      const part = ll.slice(0, k);
      casing.setLatLngs(part);
      line.setLatLngs(part);
      flow.setLatLngs(part);
      if (k >= ll.length) {
        clearInterval(anim);
        if (ll.length > 1) {
          const car = L.marker(ll[0], { icon: L.divIcon({ className: "", iconSize: [34, 34], iconAnchor: [17, 17], html: '<div class="hsm-veh"><i class="fa-solid fa-car-side"></i></div>' }), interactive: false, zIndexOffset: 400 }).addTo(map);
          layers.push(car);
          const step = Math.max(1, Math.ceil(ll.length / 140));
          let i = 0;
          veh = setInterval(() => {
            i += step;
            if (i >= ll.length) i = 0;
            car.setLatLng(ll[i]);
          }, 60);
        }
      }
    }, 28);
    const bounds = L.latLngBounds([[a.lat, a.lng], [b.lat, b.lng]]).pad(0.2);
    fitFn = () => map.fitBounds(bounds, fitPad());
    fitFn();
  };

  tabsEl.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    sel = b.dataset.k;
    draw();
  });
  q('[data-a="fit"]').onclick = () => fitFn();

  setMe();
  draw();

  if (navigator.geolocation) {
    wid = navigator.geolocation.watchPosition(p => {
      if (closed) return;
      const np = { lat: p.coords.latitude, lng: p.coords.longitude };
      const moved = pts.me ? hav(pts.me, np) * 1000 : 1e9;
      const firstFix = !pts.me;
      pts.me = np;
      lastMe = np;
      setMe();
      if (firstFix) { sel = ""; draw(); }
      else if (moved > 60 && Date.now() - lastDraw > 15000 && sel.startsWith("m")) draw();
    }, () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
  }

  return close;
    }
  
