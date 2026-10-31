import { supabase } from "./supabase.js";
import { t, getLang, initLang, esc, naira, toast, thumb, setDevice } from "./pub.js";
import { openRouteMap } from "./hsmap.js";

const $ = id => document.getElementById(id);
const JSQR = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js";

const X = {
  en: {
    camDenied: "Camera is blocked. Allow camera access or type the code.", camNone: "No camera found on this device.",
    scanning: "Point the camera at the QR code.", found: "Code found", noQr: "No QR code found in that photo.",
    open: "Opening order...", notfound: "This code does not exist. Check it and try again.", wait: "Too many wrong attempts. Wait 10 minutes.",
    invalid: "Enter the full order code.", net: "Network problem. Check your internet and try again.", paid: "Goods paid. Check the items below.",
    used: "This code was already used. Goods were delivered.", usedAt: "Delivered", items: "Goods to deliver", total: "Total paid", cust: "Customer",
    proof: "Payment proof", map: "Show route on map", gmap: "Open in Google Maps", call: "Call customer", wa: "WhatsApp", confirm: "Confirm delivery",
    cTitle: "Confirm delivery", cText: "Press confirm only after the customer has received all the goods.", dName: "Your name", dNote: "Note (optional)",
    cancel: "Cancel", yes: "Confirm", far: "You are {km} from the delivery point. Confirm anyway?", nameReq: "Enter your name.",
    done: "Delivery confirmed", doneP: "The customer's address, phone and payment proof were removed. This code can no longer open the order.",
    another: "Scan another order", noloc: "Customer location was not shared. Use the address or call the customer.", when: "Ordered", carton: "Carton"
  },
  ha: {
    camDenied: "An hana kyamara. Ka ba da izini ko ka rubuta lambar.", camNone: "Ba a sami kyamara a na'urar nan ba.",
    scanning: "Ka nuna kyamara ga QR code.", found: "An samo lamba", noQr: "Ba a sami QR code a hoton ba.",
    open: "Ana buɗe oda...", notfound: "Wannan lambar babu ita. Ka duba ka sake gwadawa.", wait: "Ka yi kuskure sau da yawa. Ka jira minti 10.",
    invalid: "Ka shigar da cikakkiyar lambar oda.", net: "Matsalar intanet. Ka duba ka sake gwadawa.", paid: "An biya kayan. Ka duba abubuwan da ke ƙasa.",
    used: "An riga an yi amfani da wannan lambar. An isar da kayan.", usedAt: "An isar", items: "Kayan da za a kai", total: "Jimlar da aka biya", cust: "Kwastoma",
    proof: "Shaidar biya", map: "Nuna hanya a taswira", gmap: "Buɗe a Google Maps", call: "Kira kwastoma", wa: "WhatsApp", confirm: "Tabbatar da isarwa",
    cTitle: "Tabbatar da isarwa", cText: "Ka danna tabbatarwa ne kawai bayan kwastoma ya karɓi duk kayan.", dName: "Sunanka", dNote: "Bayani (zaɓi)",
    cancel: "Soke", yes: "Tabbatar", far: "Kana {km} daga wurin isarwa. Za ka tabbatar ko da haka?", nameReq: "Ka rubuta sunanka.",
    done: "An tabbatar da isarwa", doneP: "An share adireshin kwastoma, wayarsa da shaidar biyansa. Wannan lambar ba za ta sake buɗe odar ba.",
    another: "Duba wata oda", noloc: "Kwastoma bai tura wurinsa ba. Ka yi amfani da adireshi ko ka kira shi.", when: "An yi oda", carton: "Kwali"
  }
};
const x = k => (X[getLang()] || X.en)[k] ?? k;

let stream = null;
let timer = 0;
let detector = null;
let jsqrP = null;
let live = false;
let current = null;
let busy = false;

const telLink = p => "tel:" + String(p || "").replace(/[^\d+]/g, "");
const waNum = p => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("234")) return d;
  if (d.startsWith("0")) return "234" + d.slice(1);
  return d;
};
const safeUrl = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
const hav = (a, b) => {
  const rad = d => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

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

function msg(text, bad) {
  const el = $("scanMsg");
  el.textContent = text || "";
  el.style.color = bad ? "var(--r2)" : "var(--g2)";
}

function stopScan() {
  live = false;
  clearTimeout(timer);
  if (stream) stream.getTracks().forEach(z => z.stop());
  stream = null;
  $("vid").srcObject = null;
  document.querySelector(".vwrap").classList.remove("live");
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

async function setupDetector() {
  if (detector || !("BarcodeDetector" in window)) return;
  try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { detector = null; }
}

async function loop() {
  if (!live) return;
  const v = $("vid");
  if (v.readyState >= 2 && v.videoWidth) {
    const scale = Math.min(1, 640 / v.videoWidth);
    const raw = await decodeSource(v, Math.round(v.videoWidth * scale), Math.round(v.videoHeight * scale));
    if (raw && live) {
      stopScan();
      if (navigator.vibrate) navigator.vibrate(80);
      msg(x("found"));
      lookup(extractCode(raw));
      return;
    }
  }
  timer = setTimeout(loop, 160);
}

async function startScan() {
  stopScan();
  msg("");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return msg(x("camNone"), true);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
  } catch (e) {
    return msg(e && e.name === "NotFoundError" ? x("camNone") : x("camDenied"), true);
  }
  await setupDetector();
  if (!detector) loadJsQr();
  const v = $("vid");
  v.srcObject = stream;
  try { await v.play(); } catch (e) {}
  document.querySelector(".vwrap").classList.add("live");
  msg(x("scanning"));
  live = true;
  loop();
}

$("scanStart").onclick = startScan;

$("scanFile").addEventListener("change", async e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  await setupDetector();
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    const raw = await decodeSource(bmp, Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    if (raw) lookup(extractCode(raw));
    else msg(x("noQr"), true);
  } catch (err) {
    msg(x("noQr"), true);
  }
});

function setTab(scan) {
  $("tabScan").classList.toggle("on", scan);
  $("tabType").classList.toggle("on", !scan);
  $("scanBox").hidden = !scan;
  $("typeBox").hidden = scan;
  if (scan) startScan();
  else { stopScan(); setTimeout(() => $("codeIn").focus(), 50); }
}
$("tabScan").onclick = () => setTab(true);
$("tabType").onclick = () => setTab(false);
$("codeIn").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9/\-\s]/g, ""); });
$("typeBox").addEventListener("submit", e => {
  e.preventDefault();
  lookup($("codeIn").value.trim());
});

function showResult(html) {
  const r = $("result");
  r.innerHTML = html;
  r.hidden = false;
  r.scrollIntoView({ behavior: "smooth", block: "start" });
}

function errBox(text) {
  showResult(`<div class="pn"><div class="banner bad"><i class="fa-solid fa-circle-exclamation"></i><span>${esc(text)}</span></div></div>`);
}

async function lookup(code) {
  if (busy) return;
  const c = String(code || "").trim();
  if (c.replace(/[^A-Za-z0-9]/g, "").length < 4) return errBox(x("invalid"));
  busy = true;
  msg(x("open"));
  try {
    const { data, error } = await supabase.rpc("driver_lookup", { p_code: c });
    if (error) throw error;
    if (!data || !data.ok) {
      const k = data && data.code;
      return errBox(k === "wait" ? x("wait") : k === "invalid" ? x("invalid") : x("notfound"));
    }
    current = data;
    renderOrder();
  } catch (e) {
    errBox(x("net"));
  } finally {
    busy = false;
    msg("");
  }
}

function renderOrder() {
  const d = current;
  if (!d) return;
  if (d.status === "delivered") {
    const when = d.delivered_at ? new Date(Number(d.delivered_at)).toLocaleString() : "";
    return showResult(`<div class="pn rcard"><div class="rcode"><b>${esc(d.code)}</b></div><div class="banner used"><i class="fa-solid fa-ban"></i><span>${esc(x("used"))}${when ? `<br><small>${esc(x("usedAt"))}: ${esc(when)}</small>` : ""}</span></div><button class="bt" type="button" data-a="again"><i class="fa-solid fa-qrcode"></i>${esc(x("another"))}</button></div>`);
  }
  const items = Array.isArray(d.items) ? d.items : [];
  const hasPos = typeof d.lat === "number" && typeof d.lng === "number";
  const gq = hasPos ? `${d.lat},${d.lng}` : encodeURIComponent(d.address || "");
  const proof = safeUrl(d.proof);
  const rows = items.map(i => `<div class="grow"><img src="${esc(safeUrl(i.image) ? thumb(i.image, "t") : "")}" alt="" onerror="this.style.visibility='hidden'"><div><b>${esc(i.name)}</b><small>${esc(x("carton"))} · ${esc(naira(Number(i.price) || 0))}</small></div><div class="q">×${esc(i.qty)}</div></div>`).join("");
  showResult(`<div class="pn rcard">
    <div class="rcode"><b>${esc(d.code)}</b><span>${esc(x("when"))}: ${esc(new Date(Number(d.created_at) || Date.now()).toLocaleString())}</span></div>
    <div class="banner ok"><i class="fa-solid fa-circle-check"></i><span>${esc(x("paid"))}</span></div>
    <div class="glist"><small class="lbl">${esc(x("items"))}</small>${rows}</div>
    <div class="gtot"><span>${esc(x("total"))}</span><b>${esc(naira(Number(d.total) || 0))}</b></div>
    <div class="cinfo">
      <div class="r"><i class="fa-solid fa-user"></i><span>${esc(d.name || "")}</span></div>
      <div class="r"><i class="fa-solid fa-phone"></i><span>${esc(d.phone || "")}</span></div>
      <div class="r"><i class="fa-solid fa-location-dot"></i><span>${esc(d.address || "")}</span></div>
      ${hasPos ? "" : `<div class="r"><i class="fa-solid fa-circle-info"></i><span>${esc(x("noloc"))}</span></div>`}
    </div>
    ${proof ? `<div class="proofbox"><small>${esc(x("proof"))}</small><img src="${esc(proof)}" alt="" data-zoom="${esc(proof)}"></div>` : ""}
    <div class="dbtns">
      ${hasPos ? `<button class="bt blue" type="button" data-a="map"><i class="fa-solid fa-route"></i>${esc(x("map"))}</button>` : ""}
      <a class="bt ghost" target="_blank" rel="noopener" href="${hasPos ? `https://www.google.com/maps/dir/?api=1&destination=${gq}&travelmode=driving` : `https://www.google.com/maps/search/?api=1&query=${gq}`}"><i class="fa-solid fa-diamond-turn-right"></i>${esc(x("gmap"))}</a>
      <a class="bt" href="${telLink(d.phone)}"><i class="fa-solid fa-phone"></i>${esc(x("call"))}</a>
      <a class="bt wa" target="_blank" rel="noopener" href="https://wa.me/${waNum(d.phone)}"><i class="fa-brands fa-whatsapp"></i>${esc(x("wa"))}</a>
    </div>
    <button class="bt red big wide" type="button" data-a="confirm"><i class="fa-solid fa-check-double"></i>${esc(x("confirm"))}</button>
  </div>`);
}

function getPos(timeout) {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout, maximumAge: 20000 });
  });
}

function askConfirm(extra) {
  return new Promise(res => {
    const dlg = $("dlg");
    const saved = localStorage.getItem("hs_driver") || "";
    dlg.innerHTML = `<div class="dlgc"><h3>${esc(x("cTitle"))}</h3><p>${esc(x("cText"))}</p>${extra ? `<div class="warnbox">${esc(extra)}</div>` : ""}<div class="fld"><input id="dgName" type="text" maxlength="60" value="${esc(saved)}" placeholder="${esc(x("dName"))}" autocomplete="name"></div><div class="fld"><input id="dgNote" type="text" maxlength="200" placeholder="${esc(x("dNote"))}"></div><div class="row"><button class="bt ghost" type="button" data-r="no">${esc(x("cancel"))}</button><button class="bt red" type="button" data-r="yes"><i class="fa-solid fa-check"></i>${esc(x("yes"))}</button></div></div>`;
    dlg.hidden = false;
    const done = v => { dlg.hidden = true; dlg.innerHTML = ""; dlg.onclick = null; res(v); };
    dlg.onclick = e => {
      const b = e.target.closest("[data-r]");
      if (e.target === dlg || (b && b.dataset.r === "no")) return done(null);
      if (b && b.dataset.r === "yes") {
        const name = $("dgName").value.trim();
        if (name.length < 2) return toast("error", x("nameReq"));
        try { localStorage.setItem("hs_driver", name); } catch (err) {}
        done({ name, note: $("dgNote").value.trim() });
      }
    };
  });
}

async function confirmDelivery() {
  if (!current || busy) return;
  const pos = await getPos(6000);
  let extra = "";
  if (pos && typeof current.lat === "number" && typeof current.lng === "number") {
    const d = hav(pos, { lat: current.lat, lng: current.lng });
    if (d > 0.4) extra = x("far").replace("{km}", d < 10 ? d.toFixed(1) + " km" : Math.round(d) + " km");
  }
  const ans = await askConfirm(extra);
  if (!ans) return;
  busy = true;
  try {
    const { data, error } = await supabase.rpc("driver_confirm", { p_code: current.code, p_driver: ans.name, p_note: ans.note || null, p_lat: pos ? pos.lat : null, p_lng: pos ? pos.lng : null });
    if (error) throw error;
    if (!data || !data.ok) return toast("error", data && data.code === "wait" ? x("wait") : x("notfound"));
    current = null;
    showResult(`<div class="pn donecard"><div class="mk"><i class="fa-solid fa-check"></i></div><h2>${esc(x("done"))}</h2><p>${esc(x("doneP"))}</p><button class="bt" type="button" data-a="again"><i class="fa-solid fa-qrcode"></i>${esc(x("another"))}</button></div>`);
  } catch (e) {
    toast("error", x("net"));
  } finally {
    busy = false;
  }
}

$("result").addEventListener("click", e => {
  const z = e.target.closest("[data-zoom]");
  if (z) { $("zoomImg").src = z.dataset.zoom; $("zoom").hidden = false; return; }
  const a = e.target.closest("[data-a]");
  if (!a) return;
  if (a.dataset.a === "map" && current) {
    openRouteMap({
      title: current.name,
      lang: getLang(),
      cust: { lat: current.lat, lng: current.lng, name: current.name, address: current.address, phone: current.phone }
    });
  }
  if (a.dataset.a === "confirm") confirmDelivery();
  if (a.dataset.a === "again") {
    current = null;
    $("result").hidden = true;
    $("codeIn").value = "";
    setTab(true);
    scrollTo({ top: 0, behavior: "smooth" });
  }
});

$("zoom").addEventListener("click", () => { $("zoom").hidden = true; });
document.addEventListener("visibilitychange", () => { if (document.hidden) stopScan(); });
window.addEventListener("pagehide", stopScan);
window.addEventListener("langchange", () => { if (current) renderOrder(); });

setDevice();
initLang();

const fromUrl = new URLSearchParams(location.search).get("code");
if (fromUrl) {
  $("scanBox").hidden = true;
  $("typeBox").hidden = false;
  $("tabScan").classList.remove("on");
  $("tabType").classList.add("on");
  $("codeIn").value = fromUrl.toUpperCase();
  lookup(fromUrl);
} else {
  startScan();
}
