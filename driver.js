import { supabase } from "./supabase.js";
import { getLang, initLang, esc, naira, toast, thumb, setDevice } from "./pub.js";
import { openRouteMap } from "./hsmap.js";

const $ = id => document.getElementById(id);
const JSQR = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js";
const KEY = "hs_drv_key";
const PING_MS = 8000;
const LIST_MS = 15000;

const X = {
  en: {
    bad: "This code is not valid.", blocked: "This driver account is blocked. Call the office.",
    net: "Network problem. Check your internet and try again.", wait: "Too many attempts. Wait 10 minutes.",
    hello: "Hello", none: "No orders for you right now.", noneSub: "New orders from the office appear here automatically.",
    assigned: "Assigned to you", open: "Open route", call: "Call", wa: "WhatsApp", back: "Back to my orders",
    gps: "Location is on", gpsOff: "Turn on location to share where you are.", gpsDenied: "Location is blocked. Allow it in your phone settings.",
    todayDone: "Delivered today", noPos: "The customer did not share a map location. Use the address or call him.",
    scan: "Scan QR", type: "Type code", camStart: "Tap to turn on the camera", camStop: "Turn off camera", fromPhoto: "From a photo",
    camDenied: "Camera is blocked. Allow camera access or type the code.", camNone: "No camera found on this device.",
    scanning: "Point the camera at the QR code.", found: "Code found. Checking...", noQr: "No QR code found in that photo.", checking: "Checking the code...",
    inv: "Enter the full code.", mismatch: "This code does not belong to this order. Check the slip.", used: "This order was already delivered.",
    paid: "Payment confirmed. Hand over the goods below.", items: "Goods to hand over", total: "Total paid", proof: "Payment proof",
    confirm: "Goods handed over - confirm delivery", cTitle: "Confirm delivery", cText: "Press confirm only after the customer has received all the goods.",
    dNote: "Note (optional)", cancel: "Cancel", yes: "Confirm", far: "You are {km} from the delivery point. Confirm anyway?",
    done: "Delivery confirmed", doneP: "Delivery is saved. The office can review this order from its history.",
    carton: "Carton", logout: "Sign out", offline: "You are offline. Showing your last orders.", slip: "Customer's slip", slipSub: "Scan the QR code on the slip, or type the code the customer shows you.",
    confirmHere: "I am at the customer - scan slip", sign: "Sign in", keyLbl: "Your driver code", keyPh: "DV-XXXXXXXX"
  },
  ha: {
    bad: "Wannan lambar ba ta dace ba.", blocked: "An kulle wannan asusun direba. Ka kira ofis.",
    net: "Matsalar intanet. Ka duba ka sake gwadawa.", wait: "Ka yi ƙoƙari sau da yawa. Ka jira minti 10.",
    hello: "Sannu", none: "Babu oda a gare ka yanzu.", noneSub: "Sabbin oda daga ofis suna bayyana a nan ta atomatik.",
    assigned: "An ba ka", open: "Buɗe hanya", call: "Kira", wa: "WhatsApp", back: "Koma ga odata",
    gps: "Location yana kunne", gpsOff: "Kunna location don a raba inda kake.", gpsDenied: "An hana location. Ba da izini a saitunan waya.",
    todayDone: "An kai yau", noPos: "Kwastoma bai tura wurin taswira ba. Ka yi amfani da adireshi ko ka kira shi.",
    scan: "Duba QR", type: "Rubuta lamba", camStart: "Danna don kunna kyamara", camStop: "Kashe kyamara", fromPhoto: "Daga hoto",
    camDenied: "An hana kyamara. Ba da izini ko rubuta lambar.", camNone: "Ba a sami kyamara a wannan na'ura ba.",
    scanning: "Nuna kyamara ga QR code.", found: "An samo lamba. Ana dubawa...", noQr: "Ba a sami QR code a hoton ba.", checking: "Ana duba lambar...",
    inv: "Ka rubuta cikakkiyar lamba.", mismatch: "Wannan lambar ba ta wannan odar ba ce. Duba slip.", used: "An riga an kai wannan odar.",
    paid: "An tabbatar da biya. Ba da kayan da ke ƙasa.", items: "Kayan da za a ba shi", total: "Jimlar da aka biya", proof: "Shaidar biya",
    confirm: "An ba da kayan - tabbatar da isarwa", cTitle: "Tabbatar da isarwa", cText: "Ka danna tabbatarwa ne kawai bayan kwastoma ya karɓi duk kayan.",
    dNote: "Bayani (zaɓi)", cancel: "Soke", yes: "Tabbatar", far: "Kana {km} daga wurin isarwa. Za ka tabbatar ko da haka?",
    done: "An tabbatar da isarwa", doneP: "An adana isarwar. Ofis zai iya duba wannan odar daga tarihi.",
    carton: "Kwali", logout: "Fita", offline: "Babu intanet. Ana nuna odan ƙarshe.", slip: "Slip ɗin kwastoma", slipSub: "Duba QR da ke slip ko rubuta lambar da kwastoma ya nuna maka.",
    confirmHere: "Na isa wurin kwastoma - duba slip", sign: "Shiga", keyLbl: "Lambar direba", keyPh: "DV-XXXXXXXX"
  }
};
const x = k => (X[getLang()] || X.en)[k] ?? k;

let key = "";
let me = null;
let orders = [];
let active = null;
let verified = null;
let stream = null;
let live = false;
let scanTimer = 0;
let detector = null;
let jsqrP = null;
let busy = false;
let watchId = null;
let lastFix = null;
let pingTimer = 0;
let listTimer = 0;
let closeMap = null;

const telLink = p => "tel:" + String(p || "").replace(/[^\d+]/g, "");
const waNum = p => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("234")) return d;
  if (d.startsWith("0")) return "234" + d.slice(1);
  return d;
};
const safeUrl = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
const hasPos = o => !!o && typeof o.lat === "number" && typeof o.lng === "number";
const hav = (a, b) => {
  const rad = v => (v * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

function setMsg(id, text, kind) {
  const el = $(id);
  el.textContent = text || "";
  el.className = "dmsg" + (kind ? " " + kind : "");
}

function show(id, on) {
  $(id).hidden = !on;
}

function loadJsQr() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (jsqrP) return jsqrP;
  jsqrP = new Promise(res => {
    const s = document.createElement("script");
    s.src = JSQR;
    s.onload = () => res(window.jsQR || null);
    s.onerror = () => { jsqrP = null; res(null); };
    document.head.appendChild(s);
  });
  return jsqrP;
}

function extractCode(text) {
  const s = String(text || "").trim();
  try {
    const u = new URL(s);
    const c = u.searchParams.get("code");
    if (c) return c.trim();
  } catch (e) {}
  return s;
}

async function setupDetector() {
  if (detector || !("BarcodeDetector" in window)) return;
  try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { detector = null; }
}

async function decodeSource(src, w, h) {
  if (detector) {
    try {
      const r = await detector.detect(src);
      return r[0] ? r[0].rawValue : "";
    } catch (e) { return ""; }
  }
  const lib = await loadJsQr();
  if (!lib) return "";
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const c = cv.getContext("2d", { willReadFrequently: true });
  c.drawImage(src, 0, 0, w, h);
  const d = c.getImageData(0, 0, w, h);
  const r = lib(d.data, w, h, { inversionAttempts: "dontInvert" });
  return r ? r.data : "";
}

function stopScan() {
  live = false;
  clearTimeout(scanTimer);
  if (stream) stream.getTracks().forEach(z => z.stop());
  stream = null;
  $("vid").srcObject = null;
  $("vwrap").classList.remove("live");
  show("scanStop", false);
}

async function scanLoop() {
  if (!live) return;
  const v = $("vid");
  if (v.readyState >= 2 && v.videoWidth) {
    const scale = Math.min(1, 640 / v.videoWidth);
    const raw = await decodeSource(v, Math.round(v.videoWidth * scale), Math.round(v.videoHeight * scale));
    if (raw && live) {
      stopScan();
      if (navigator.vibrate) navigator.vibrate(80);
      setMsg("scanMsg", x("found"), "good");
      verifyCustomer(extractCode(raw));
      return;
    }
  }
  scanTimer = setTimeout(scanLoop, 160);
}

async function startScan() {
  stopScan();
  setMsg("scanMsg", "");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return setMsg("scanMsg", x("camNone"), "bad");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
  } catch (e) {
    return setMsg("scanMsg", e && e.name === "NotFoundError" ? x("camNone") : x("camDenied"), "bad");
  }
  await setupDetector();
  if (!detector) loadJsQr();
  const v = $("vid");
  v.srcObject = stream;
  try { await v.play(); } catch (e) {}
  $("vwrap").classList.add("live");
  show("scanStop", true);
  setMsg("scanMsg", x("scanning"), "good");
  live = true;
  scanLoop();
}

$("scanStart").onclick = startScan;
$("scanStop").onclick = () => { stopScan(); setMsg("scanMsg", ""); };

$("scanFile").addEventListener("change", async e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  await setupDetector();
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    const raw = await decodeSource(bmp, Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    if (raw) verifyCustomer(extractCode(raw));
    else setMsg("scanMsg", x("noQr"), "bad");
  } catch (err) {
    setMsg("scanMsg", x("noQr"), "bad");
  }
});

function setTab(scan) {
  $("tabScan").classList.toggle("on", scan);
  $("tabType").classList.toggle("on", !scan);
  show("scanBox", scan);
  show("typeBox", !scan);
  if (!scan) stopScan();
}
$("tabScan").onclick = () => setTab(true);
$("tabType").onclick = () => setTab(false);
$("codeIn").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9/\-\s]/g, ""); });
$("typeBox").addEventListener("submit", e => {
  e.preventDefault();
  verifyCustomer($("codeIn").value);
});

function startGps() {
  if (!navigator.geolocation || watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(p => {
    lastFix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading };
    setMsg("gpsMsg", x("gps"), "good");
    show("gpsBar", true);
  }, err => {
    setMsg("gpsMsg", err && err.code === 1 ? x("gpsDenied") : x("gpsOff"), "bad");
    show("gpsBar", true);
  }, { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });
}

async function pingOnce() {
  if (!key || !lastFix) return;
  try {
    await supabase.rpc("driver_ping", { p_key: key, p_lat: lastFix.lat, p_lng: lastFix.lng, p_acc: lastFix.acc ?? null, p_speed: lastFix.speed ?? null, p_heading: lastFix.heading ?? null });
  } catch (e) {}
}

async function setOnline(on) {
  if (!key) return;
  try { await supabase.rpc("driver_set_online", { p_key: key, p_online: on }); } catch (e) {}
}

function startPing() {
  clearInterval(pingTimer);
  pingTimer = setInterval(pingOnce, PING_MS);
  pingOnce();
  setOnline(true);
}

function stopPing() {
  clearInterval(pingTimer);
  setOnline(false);
}

function orderCard(o) {
  const pos = hasPos(o);
  const km = pos && lastFix ? hav(lastFix, o) : null;
  const items = Array.isArray(o.items) ? o.items : [];
  const itemText = items.map(i => `${esc(i.name)} × ${esc(i.qty)}`).join(", ");
  return `<article class="dd-card" data-d="${esc(o.dcode)}">
    <div class="dd-top"><span class="dd-tag"><i class="fa-solid fa-truck-fast"></i>${esc(x("assigned"))}</span>${km != null ? `<span class="dd-km">${km < 10 ? km.toFixed(1) : Math.round(km)} km</span>` : ""}</div>
    <h3>${esc(o.name || "")}</h3>
    <p class="dd-adr"><i class="fa-solid fa-location-dot"></i><span>${esc(o.address || "")}</span></p>
    <p class="dd-items">${itemText}</p>
    <div class="dd-btns">
      <button class="bt blue" type="button" data-a="open"><i class="fa-solid fa-route"></i>${esc(x("open"))}</button>
      ${o.phone ? `<a class="bt" href="${telLink(o.phone)}"><i class="fa-solid fa-phone"></i>${esc(x("call"))}</a>` : ""}
    </div>
  </article>`;
}

function renderOrders() {
  $("hello").textContent = `${x("hello")}, ${me ? me.name : ""}`;
  $("orders").innerHTML = orders.length
    ? orders.map(orderCard).join("")
    : `<div class="dd-none"><i class="fa-solid fa-mug-hot"></i><b>${esc(x("none"))}</b><span>${esc(x("noneSub"))}</span></div>`;
  $("todayDone").textContent = me && me.done_today != null ? me.done_today : 0;
  $("todayLbl").textContent = x("todayDone");
}

async function loadOrders() {
  if (!key) return;
  try {
    const { data, error } = await supabase.rpc("driver_orders", { p_key: key });
    if (error) throw error;
    if (!data || !data.ok) {
      if (data && (data.code === "blocked" || data.code === "notfound")) return signOut(data.code === "blocked" ? x("blocked") : x("bad"));
      return;
    }
    me = { name: data.name, done_today: data.done_today };
    orders = Array.isArray(data.orders) ? data.orders : [];
    setMsg("ordMsg", "");
    renderOrders();
  } catch (e) {
    setMsg("ordMsg", x("offline"), "bad");
  }
}

function openRoute(o) {
  if (closeMap) { try { closeMap(); } catch (e) {} closeMap = null; }
  active = o;
  show("sList", false);
  show("sRoute", true);
  $("routeTitle").textContent = o.name || "";
  $("routeAddr").textContent = o.address || "";
  show("routeCall", !!o.phone);
  $("routeCall").href = o.phone ? telLink(o.phone) : "#";
  show("routeWa", !!o.phone);
  $("routeWa").href = o.phone ? `https://wa.me/${waNum(o.phone)}` : "#";
  const gq = hasPos(o) ? `${o.lat},${o.lng}` : encodeURIComponent(o.address || "");
  $("routeGm").href = hasPos(o)
    ? `https://www.google.com/maps/dir/?api=1&destination=${gq}&travelmode=driving`
    : `https://www.google.com/maps/search/?api=1&query=${gq}`;
  const mount = $("routeMap");
  mount.innerHTML = "";
  if (hasPos(o)) {
    openRouteMap({
      mount,
      lang: getLang(),
      cust: { lat: o.lat, lng: o.lng, name: o.name, address: o.address, phone: o.phone },
      top: { name: o.name, phone: o.phone }
    }).then(c => { closeMap = c; });
  } else {
    mount.innerHTML = `<div class="dd-note">${esc(x("noPos"))}</div>`;
  }
  scrollTo({ top: 0, behavior: "smooth" });
}

function closeRoute() {
  if (closeMap) { try { closeMap(); } catch (e) {} closeMap = null; }
  $("routeMap").innerHTML = "";
  active = null;
  verified = null;
  stopScan();
  show("sRoute", false);
  show("sSlip", false);
  show("sProof", false);
  show("sDone", false);
  show("sList", true);
  loadOrders();
  scrollTo({ top: 0, behavior: "smooth" });
}

function openSlip() {
  if (!active) return;
  show("sSlip", true);
  setMsg("scanMsg", "");
  setMsg("codeMsg", "");
  setTab(true);
  $("sSlip").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function verifyCustomer(code) {
  if (!active || busy) return;
  const c = String(code || "").trim();
  if (c.replace(/[^A-Za-z0-9]/g, "").length < 4) return setMsg("codeMsg", x("inv"), "bad");
  busy = true;
  setMsg("codeMsg", x("checking"));
  try {
    const { data, error } = await supabase.rpc("dispatch_verify", { p_dcode: active.dcode, p_code: c });
    if (error) throw error;
    if (!data || !data.ok) {
      const map = { mismatch: x("mismatch"), used: x("used"), wait: x("wait"), invalid: x("inv"), cancelled: x("mismatch") };
      return setMsg("codeMsg", map[data && data.code] || x("mismatch"), "bad");
    }
    verified = data;
    stopScan();
    setMsg("codeMsg", "");
    renderProof();
    show("sProof", true);
    $("sProof").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    setMsg("codeMsg", x("net"), "bad");
  } finally {
    busy = false;
  }
}

function renderProof() {
  const v = verified;
  if (!v) return;
  const items = Array.isArray(v.items) ? v.items : [];
  const proof = safeUrl(v.proof);
  const rows = items.map(i => `<div class="grow"><img src="${esc(safeUrl(i.image) ? thumb(i.image, "t") : "")}" alt="" onerror="this.style.visibility='hidden'"><div><b>${esc(i.name)}</b><small>${esc(x("carton"))} · ${esc(naira(Number(i.price) || 0))}</small></div><div class="q">×${esc(i.qty)}</div></div>`).join("");
  $("sProof").innerHTML = `<div class="dd-proof">
    <div class="banner ok"><i class="fa-solid fa-circle-check"></i><span>${esc(x("paid"))}</span></div>
    <div class="glist"><small class="lbl">${esc(x("items"))}</small>${rows}</div>
    <div class="gtot"><span>${esc(x("total"))}</span><b>${esc(naira(Number(v.total) || 0))}</b></div>
    ${proof ? `<div class="proofbox"><small>${esc(x("proof"))}</small><img src="${esc(proof)}" alt="" data-zoom="${esc(proof)}"></div>` : ""}
    <button class="bt red big wide" type="button" data-a="confirm"><i class="fa-solid fa-check-double"></i>${esc(x("confirm"))}</button>
  </div>`;
}

function askConfirm(extra) {
  return new Promise(res => {
    const dlg = $("dlg");
    dlg.innerHTML = `<div class="dlgc"><h3>${esc(x("cTitle"))}</h3><p>${esc(x("cText"))}</p>${extra ? `<div class="warnbox">${esc(extra)}</div>` : ""}<div class="fld"><input id="dgNote" type="text" maxlength="200" placeholder="${esc(x("dNote"))}"></div><div class="row"><button class="bt ghost" type="button" data-r="no">${esc(x("cancel"))}</button><button class="bt red" type="button" data-r="yes"><i class="fa-solid fa-check"></i>${esc(x("yes"))}</button></div></div>`;
    dlg.hidden = false;
    const finish = v => { dlg.hidden = true; dlg.innerHTML = ""; dlg.onclick = null; res(v); };
    dlg.onclick = e => {
      const b = e.target.closest("[data-r]");
      if (e.target === dlg || (b && b.dataset.r === "no")) return finish(null);
      if (b && b.dataset.r === "yes") finish({ note: $("dgNote").value.trim() });
    };
  });
}

function getPos(timeout) {
  return new Promise(res => {
    if (lastFix) return res(lastFix);
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout, maximumAge: 20000 });
  });
}

async function confirmDelivery() {
  if (!active || !verified || busy) return;
  const pos = await getPos(6000);
  let extra = "";
  if (pos && hasPos(verified)) {
    const d = hav(pos, { lat: verified.lat, lng: verified.lng });
    if (d > 0.4) extra = x("far").replace("{km}", d < 10 ? d.toFixed(1) + " km" : Math.round(d) + " km");
  }
  const ans = await askConfirm(extra);
  if (!ans) return;
  busy = true;
  try {
    const { data, error } = await supabase.rpc("dispatch_confirm", {
      p_dcode: active.dcode,
      p_code: verified.code,
      p_driver: me ? me.name : null,
      p_note: ans.note || null,
      p_lat: pos ? pos.lat : null,
      p_lng: pos ? pos.lng : null
    });
    if (error) throw error;
    if (!data || !data.ok) return toast("error", x("mismatch"));
    if (closeMap) { try { closeMap(); } catch (e) {} closeMap = null; }
    $("routeMap").innerHTML = "";
    stopScan();
    active = null;
    verified = null;
    show("sRoute", false);
    show("sSlip", false);
    show("sProof", false);
    $("sDone").innerHTML = `<div class="donecard"><div class="mk"><i class="fa-solid fa-check"></i></div><h2>${esc(x("done"))}</h2><p>${esc(x("doneP"))}</p><button class="bt" type="button" data-a="back"><i class="fa-solid fa-list"></i>${esc(x("back"))}</button></div>`;
    show("sDone", true);
    scrollTo({ top: 0, behavior: "smooth" });
    loadOrders();
  } catch (e) {
    toast("error", x("net"));
  } finally {
    busy = false;
  }
}

document.addEventListener("click", e => {
  const z = e.target.closest("[data-zoom]");
  if (z) { $("zoomImg").src = z.dataset.zoom; show("zoom", true); return; }
  const a = e.target.closest("[data-a]");
  if (a) {
    const k = a.dataset.a;
    if (k === "open") {
      const card = a.closest(".dd-card");
      const o = orders.find(z2 => z2.dcode === card.dataset.d);
      if (o) openRoute(o);
    }
    if (k === "slip") openSlip();
    if (k === "confirm") confirmDelivery();
    if (k === "back") closeRoute();
    return;
  }
  if (e.target.closest("#routeBack")) closeRoute();
  if (e.target.closest("#routeSlip")) openSlip();
  if (e.target.closest("#logoutBtn")) signOut();
});

$("zoom").addEventListener("click", () => show("zoom", false));

function enterDashboard() {
  show("sSignin", false);
  show("sHead", true);
  show("sList", true);
  show("sRoute", false);
  show("sSlip", false);
  show("sProof", false);
  show("sDone", false);
  startGps();
  startPing();
  loadOrders();
  clearInterval(listTimer);
  listTimer = setInterval(loadOrders, LIST_MS);
}

function signOut(msg) {
  stopPing();
  stopScan();
  if (closeMap) { try { closeMap(); } catch (e) {} closeMap = null; }
  try { localStorage.removeItem(KEY); } catch (e) {}
  key = "";
  me = null;
  orders = [];
  active = null;
  verified = null;
  clearInterval(listTimer);
  show("sHead", false);
  show("sRoute", false);
  show("sSlip", false);
  show("sProof", false);
  show("sDone", false);
  show("sList", false);
  show("sSignin", true);
  setMsg("loginMsg", msg || "");
  $("keyIn").value = "";
}

async function signIn(raw) {
  const k = String(raw || "").trim();
  if (k.replace(/[^A-Za-z0-9]/g, "").length < 6) return setMsg("loginMsg", x("bad"), "bad");
  busy = true;
  $("loginBtn").disabled = true;
  setMsg("loginMsg", "");
  try {
    const { data, error } = await supabase.rpc("driver_login", { p_key: k });
    if (error) throw error;
    if (!data || !data.ok) {
      const msg = data && data.code === "blocked" ? x("blocked") : data && data.code === "wait" ? x("wait") : x("bad");
      return setMsg("loginMsg", msg, "bad");
    }
    key = data.dkey;
    me = { name: data.name, done_today: 0 };
    try { localStorage.setItem(KEY, key); } catch (err) {}
    enterDashboard();
  } catch (e) {
    setMsg("loginMsg", x("net"), "bad");
  } finally {
    busy = false;
    $("loginBtn").disabled = false;
  }
}

$("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  signIn($("keyIn").value);
});
$("keyIn").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""); });

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopScan();
  else if (key) { pingOnce(); loadOrders(); }
});
window.addEventListener("pagehide", () => { if (key) setOnline(false); });
window.addEventListener("langchange", () => { if (key) renderOrders(); });

setDevice();
initLang();

const params = new URLSearchParams(location.search);
const urlKey = params.get("k");
if (urlKey) history.replaceState({}, "", location.pathname);
let saved = "";
try { saved = localStorage.getItem(KEY) || ""; } catch (e) {}
const start = urlKey || saved;
if (start) {
  supabase.rpc("driver_login", { p_key: start }).then(({ data, error }) => {
    if (error || !data || !data.ok) {
      signOut(data && data.code === "blocked" ? x("blocked") : "");
      return;
    }
    key = data.dkey;
    me = { name: data.name, done_today: 0 };
    try { localStorage.setItem(KEY, key); } catch (e) {}
    enterDashboard();
  }, () => signOut(x("net")));
} else {
  show("sSignin", true);
}
