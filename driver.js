import { supabase } from "./supabase.js";
import { getLang, initLang, esc, naira, toast, thumb, setDevice } from "./pub.js";
import { openRouteMap } from "./hsmap.js";

const $ = id => document.getElementById(id);
const JSQR = "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js";
const KEY = "hs_dc";

const X = {
  en: {
    open: "Opening delivery...", needD: "Enter the office code first. The customer code is kept for the next step.", invalid: "Enter the full code.",
    notfound: "This code does not exist. Check it and try again.", cancelled: "The office cancelled this code. Ask for a new one.",
    wait: "Too many wrong attempts. Wait 10 minutes.", net: "Network problem. Check your internet and try again.",
    doneAlready: "This delivery is already completed.", deliverTo: "Deliver to", call: "Call", wa: "WhatsApp", gmaps: "Open in Google Maps",
    copy: "Copy address", copied: "Address copied", noPos: "The customer did not share a map location. Use the address or call him.",
    searchMap: "Search the address in Google Maps", camDenied: "Camera is blocked. Allow camera access or type the code.", camNone: "No camera found on this device.",
    scanning: "Point the camera at the QR code.", found: "Code found. Checking...", noQr: "No QR code found in that photo.", checking: "Checking the code...",
    mismatch: "This code does not belong to this delivery. Check the slip.", used: "This order was already delivered.", paid: "Payment confirmed. Check the goods below.",
    items: "Goods to hand over", total: "Total paid", proof: "Payment proof", confirm: "Goods handed over - confirm delivery", cTitle: "Confirm delivery",
    cText: "Press confirm only after the customer has received all the goods.", dName: "Your name", dNote: "Note (optional)", cancel: "Cancel", yes: "Confirm",
    far: "You are {km} from the delivery point. Confirm anyway?", nameReq: "Enter your name.", done: "Delivery confirmed",
    doneP: "The customer's address, phone and payment proof were removed. These codes cannot open the order again.", another: "Start another delivery",
    carton: "Carton", ordered: "Ordered"
  },
  ha: {
    open: "Ana buɗe isarwa...", needD: "Ka shigar da lambar ofis tukuna. Ana adana lambar kwastoma don mataki na gaba.", invalid: "Ka shigar da cikakkiyar lamba.",
    notfound: "Wannan lambar babu ita. Ka duba ka sake gwadawa.", cancelled: "Ofis ya soke wannan lambar. Ka nemi sabuwa.",
    wait: "Ka yi kuskure sau da yawa. Ka jira minti 10.", net: "Matsalar intanet. Ka duba ka sake gwadawa.",
    doneAlready: "An riga an kammala wannan isarwa.", deliverTo: "Kai wa", call: "Kira", wa: "WhatsApp", gmaps: "Buɗe a Google Maps",
    copy: "Kwafi adireshi", copied: "An kwafi adireshi", noPos: "Kwastoma bai tura wurin taswira ba. Ka yi amfani da adireshi ko ka kira shi.",
    searchMap: "Nemo adireshin a Google Maps", camDenied: "An hana kyamara. Ka ba da izini ko ka rubuta lambar.", camNone: "Ba a sami kyamara a na'urar nan ba.",
    scanning: "Ka nuna kyamara ga QR code.", found: "An samo lamba. Ana dubawa...", noQr: "Ba a sami QR code a hoton ba.", checking: "Ana duba lambar...",
    mismatch: "Wannan lambar ba ta wannan isarwa ba ce. Ka duba slip ɗin.", used: "An riga an kai wannan odar.", paid: "An tabbatar da biya. Ka duba kayan da ke ƙasa.",
    items: "Kayan da za a ba shi", total: "Jimlar da aka biya", proof: "Shaidar biya", confirm: "An ba da kayan - tabbatar da isarwa", cTitle: "Tabbatar da isarwa",
    cText: "Ka danna tabbatarwa ne kawai bayan kwastoma ya karɓi duk kayan.", dName: "Sunanka", dNote: "Bayani (zaɓi)", cancel: "Soke", yes: "Tabbatar",
    far: "Kana {km} daga wurin isarwa. Za ka tabbatar ko da haka?", nameReq: "Ka rubuta sunanka.", done: "An tabbatar da isarwa",
    doneP: "An share adireshin kwastoma, wayarsa da shaidar biyansa. Waɗannan lambobin ba za su sake buɗe odar ba.", another: "Fara wata isarwa",
    carton: "Kwali", ordered: "An yi oda"
  }
};
const x = k => (X[getLang()] || X.en)[k] ?? k;

let dispatch = null;
let verified = null;
let closeMap = null;
let pendingCustomer = "";
let stream = null;
let live = false;
let timer = 0;
let detector = null;
let jsqrP = null;
let busy = false;

const telLink = p => "tel:" + String(p || "").replace(/[^\d+]/g, "");
const waNum = p => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("234")) return d;
  if (d.startsWith("0")) return "234" + d.slice(1);
  return d;
};
const safeUrl = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
const hasPos = d => d && typeof d.lat === "number" && typeof d.lng === "number";
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

function setStep(n) {
  [...$("dflow").children].forEach((li, i) => li.classList.toggle("on", i < n));
}

function show(id, on) {
  $(id).hidden = !on;
}

function errText(code) {
  return code === "wait" ? x("wait") : code === "invalid" ? x("invalid") : code === "cancelled" ? x("cancelled") : code === "mismatch" ? x("mismatch") : code === "used" ? x("used") : x("notfound");
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

function stopScan() {
  live = false;
  clearTimeout(timer);
  if (stream) stream.getTracks().forEach(z => z.stop());
  stream = null;
  $("vid").srcObject = null;
  $("vwrap").classList.remove("live");
  $("scanStop").hidden = true;
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

async function loop() {
  if (!live) return;
  const v = $("vid");
  if (v.readyState >= 2 && v.videoWidth) {
    const scale = Math.min(1, 640 / v.videoWidth);
    const raw = await decodeSource(v, Math.round(v.videoWidth * scale), Math.round(v.videoHeight * scale));
    if (raw && live) {
      stopScan();
      if (navigator.vibrate) navigator.vibrate(80);
      setMsg("vMsg", x("found"), "good");
      verifyCode(extractCode(raw));
      return;
    }
  }
  timer = setTimeout(loop, 160);
}

async function startScan() {
  stopScan();
  setMsg("vMsg", "");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return setMsg("vMsg", x("camNone"), "bad");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
  } catch (e) {
    return setMsg("vMsg", e && e.name === "NotFoundError" ? x("camNone") : x("camDenied"), "bad");
  }
  await setupDetector();
  if (!detector) loadJsQr();
  const v = $("vid");
  v.srcObject = stream;
  try { await v.play(); } catch (e) {}
  $("vwrap").classList.add("live");
  $("scanStop").hidden = false;
  setMsg("vMsg", x("scanning"), "good");
  live = true;
  loop();
}

$("scanStart").onclick = startScan;
$("scanStop").onclick = () => { stopScan(); setMsg("vMsg", ""); };

$("scanFile").addEventListener("change", async e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  await setupDetector();
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
    const raw = await decodeSource(bmp, Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    if (raw) verifyCode(extractCode(raw));
    else setMsg("vMsg", x("noQr"), "bad");
  } catch (err) {
    setMsg("vMsg", x("noQr"), "bad");
  }
});

function setTab(scan) {
  $("tabScan").classList.toggle("on", scan);
  $("tabType").classList.toggle("on", !scan);
  show("scanBox", scan);
  show("typeBox", !scan);
  if (!scan) {
    stopScan();
    setTimeout(() => $("codeIn").focus(), 60);
  }
}
$("tabScan").onclick = () => setTab(true);
$("tabType").onclick = () => setTab(false);

$("dcIn").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""); });
$("codeIn").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9/\-\s]/g, ""); });

function copyText(text, msg) {
  navigator.clipboard.writeText(text).then(() => toast("ok", msg), () => {});
}

function renderInfo() {
  const d = dispatch;
  if (!d) return;
  const pos = hasPos(d);
  const gq = pos ? `${d.lat},${d.lng}` : encodeURIComponent(d.address || "");
  const gUrl = pos ? `https://www.google.com/maps/dir/?api=1&destination=${gq}&travelmode=driving` : `https://www.google.com/maps/search/?api=1&query=${gq}`;
  $("dInfo").innerHTML = `<div class="dcard">
    <div class="dwho"><i class="fa-solid fa-house-user"></i><div><small>${esc(x("deliverTo"))}</small><h2>${esc(d.name || "")}</h2></div></div>
    ${d.phone ? `<a class="dtel" href="${telLink(d.phone)}"><i class="fa-solid fa-phone"></i><b>${esc(d.phone)}</b><span>${esc(x("call"))}</span></a>` : ""}
    <p class="dadr"><i class="fa-solid fa-location-dot"></i><span>${esc(d.address || "")}</span>${d.address ? `<button type="button" data-a="copy" aria-label="${esc(x("copy"))}"><i class="fa-regular fa-copy"></i></button>` : ""}</p>
    <div class="dbtns">
      <a class="bt blue" target="_blank" rel="noopener" href="${gUrl}"><i class="fa-solid fa-diamond-turn-right"></i>${esc(pos ? x("gmaps") : x("searchMap"))}</a>
      ${d.phone ? `<a class="bt wa" target="_blank" rel="noopener" href="https://wa.me/${waNum(d.phone)}"><i class="fa-brands fa-whatsapp"></i>${esc(x("wa"))}</a>` : ""}
    </div>
  </div>`;
}

function mountMap() {
  const d = dispatch;
  if (closeMap) { try { closeMap(); } catch (e) {} closeMap = null; }
  const m = $("mapMount");
  if (!d) { m.innerHTML = ""; return; }
  if (!hasPos(d)) {
    m.innerHTML = `<div class="mapnote"><span>${esc(x("noPos"))}</span></div>`;
    return;
  }
  m.innerHTML = "";
  openRouteMap({
    mount: m,
    lang: getLang(),
    cust: { lat: d.lat, lng: d.lng, name: d.name, address: d.address, phone: d.phone },
    top: { name: d.name, phone: d.phone }
  }).then(c => { closeMap = c; });
}

function renderProof() {
  const v = verified;
  if (!v) return;
  const items = Array.isArray(v.items) ? v.items : [];
  const proof = safeUrl(v.proof);
  const rows = items.map(i => `<div class="grow"><img src="${esc(safeUrl(i.image) ? thumb(i.image, "t") : "")}" alt="" onerror="this.style.visibility='hidden'"><div><b>${esc(i.name)}</b><small>${esc(x("carton"))} · ${esc(naira(Number(i.price) || 0))}</small></div><div class="q">×${esc(i.qty)}</div></div>`).join("");
  $("sProof").innerHTML = `<div class="rcard">
    <div class="rcode"><b>${esc(v.code)}</b><span>${esc(x("ordered"))}: ${esc(new Date(Number(v.created_at) || Date.now()).toLocaleString())}</span></div>
    <div class="banner ok"><i class="fa-solid fa-circle-check"></i><span>${esc(x("paid"))}</span></div>
    <div class="glist"><small class="lbl">${esc(x("items"))}</small>${rows}</div>
    <div class="gtot"><span>${esc(x("total"))}</span><b>${esc(naira(Number(v.total) || 0))}</b></div>
    ${proof ? `<div class="proofbox"><small>${esc(x("proof"))}</small><img src="${esc(proof)}" alt="" data-zoom="${esc(proof)}"></div>` : ""}
    <button class="bt red big wide" type="button" data-a="confirm"><i class="fa-solid fa-check-double"></i>${esc(x("confirm"))}</button>
  </div>`;
}

function resetAll() {
  stopScan();
  if (closeMap) { try { closeMap(); } catch (e) {} closeMap = null; }
  dispatch = null;
  verified = null;
  pendingCustomer = "";
  try { localStorage.removeItem(KEY); } catch (e) {}
  $("dcIn").value = "";
  $("codeIn").value = "";
  $("dInfo").innerHTML = "";
  $("mapMount").innerHTML = "";
  setMsg("dMsg", "");
  setMsg("vMsg", "");
  ["sDelivery", "sVerify", "sProof", "sDone"].forEach(id => show(id, false));
  show("sDispatch", true);
  setStep(1);
  setTab(true);
  scrollTo({ top: 0, behavior: "smooth" });
}

async function openDispatch(code) {
  if (busy) return;
  const c = String(code || "").trim();
  if (c.replace(/[^A-Za-z0-9]/g, "").length < 4) return setMsg("dMsg", x("invalid"), "bad");
  busy = true;
  $("dGo").disabled = true;
  setMsg("dMsg", x("open"));
  try {
    const { data, error } = await supabase.rpc("dispatch_lookup", { p_dcode: c });
    if (error) throw error;
    if (!data || !data.ok) {
      try { localStorage.removeItem(KEY); } catch (e) {}
      return setMsg("dMsg", errText(data && data.code), "bad");
    }
    if (data.status === "done") {
      try { localStorage.removeItem(KEY); } catch (e) {}
      return setMsg("dMsg", x("doneAlready"), "bad");
    }
    dispatch = data;
    try { localStorage.setItem(KEY, data.dcode); } catch (e) {}
    setMsg("dMsg", "");
    show("sDispatch", false);
    show("sDelivery", true);
    show("sVerify", true);
    setStep(2);
    renderInfo();
    mountMap();
    if (pendingCustomer) {
      const pc = pendingCustomer;
      pendingCustomer = "";
      busy = false;
      verifyCode(pc);
    }
  } catch (e) {
    console.error(e);
    setMsg("dMsg", x("net"), "bad");
  } finally {
    busy = false;
    $("dGo").disabled = false;
  }
}

async function verifyCode(code) {
  if (!dispatch) {
    pendingCustomer = String(code || "").trim();
    return setMsg("dMsg", x("needD"), "bad");
  }
  if (busy) return;
  const c = String(code || "").trim();
  if (c.replace(/[^A-Za-z0-9]/g, "").length < 4) return setMsg("vMsg", x("invalid"), "bad");
  busy = true;
  setMsg("vMsg", x("checking"));
  try {
    const { data, error } = await supabase.rpc("dispatch_verify", { p_dcode: dispatch.dcode, p_code: c });
    if (error) throw error;
    if (!data || !data.ok) return setMsg("vMsg", errText(data && data.code), "bad");
    verified = data;
    stopScan();
    setMsg("vMsg", "");
    renderProof();
    show("sProof", true);
    setStep(3);
    $("sProof").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    console.error(e);
    setMsg("vMsg", x("net"), "bad");
  } finally {
    busy = false;
  }
}

$("dForm").addEventListener("submit", e => {
  e.preventDefault();
  openDispatch($("dcIn").value);
});

$("typeBox").addEventListener("submit", e => {
  e.preventDefault();
  verifyCode($("codeIn").value);
});

function getPos(timeout) {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout, maximumAge: 20000 });
  });
}

function askConfirm(extra) {
  return new Promise(res => {
    const dlg = $("dlg");
    const saved = localStorage.getItem("hs_driver") || (dispatch && dispatch.driver_name) || "";
    dlg.innerHTML = `<div class="dlgc"><h3>${esc(x("cTitle"))}</h3><p>${esc(x("cText"))}</p>${extra ? `<div class="warnbox">${esc(extra)}</div>` : ""}<div class="fld"><input id="dgName" type="text" maxlength="60" value="${esc(saved)}" placeholder="${esc(x("dName"))}" autocomplete="name"></div><div class="fld"><input id="dgNote" type="text" maxlength="200" placeholder="${esc(x("dNote"))}"></div><div class="row"><button class="bt ghost" type="button" data-r="no">${esc(x("cancel"))}</button><button class="bt red" type="button" data-r="yes"><i class="fa-solid fa-check"></i>${esc(x("yes"))}</button></div></div>`;
    dlg.hidden = false;
    const finish = v => { dlg.hidden = true; dlg.innerHTML = ""; dlg.onclick = null; res(v); };
    dlg.onclick = e => {
      const b = e.target.closest("[data-r]");
      if (e.target === dlg || (b && b.dataset.r === "no")) return finish(null);
      if (b && b.dataset.r === "yes") {
        const name = $("dgName").value.trim();
        if (name.length < 2) return toast("error", x("nameReq"));
        try { localStorage.setItem("hs_driver", name); } catch (err) {}
        finish({ name, note: $("dgNote").value.trim() });
      }
    };
  });
}

async function confirmDelivery() {
  if (!dispatch || !verified || busy) return;
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
      p_dcode: dispatch.dcode,
      p_code: verified.code,
      p_driver: ans.name,
      p_note: ans.note || null,
      p_lat: pos ? pos.lat : null,
      p_lng: pos ? pos.lng : null
    });
    if (error) throw error;
    if (!data || !data.ok) return toast("error", errText(data && data.code));
    stopScan();
    if (closeMap) { try { closeMap(); } catch (e) {} closeMap = null; }
    dispatch = null;
    verified = null;
    try { localStorage.removeItem(KEY); } catch (e) {}
    ["sDelivery", "sVerify", "sProof", "sDispatch"].forEach(id => show(id, false));
    $("sDone").innerHTML = `<div class="donecard"><div class="mk"><i class="fa-solid fa-check"></i></div><h2>${esc(x("done"))}</h2><p>${esc(x("doneP"))}</p><button class="bt" type="button" data-a="again"><i class="fa-solid fa-route"></i>${esc(x("another"))}</button></div>`;
    show("sDone", true);
    setStep(3);
    scrollTo({ top: 0, behavior: "smooth" });
  } catch (e) {
    console.error(e);
    toast("error", x("net"));
  } finally {
    busy = false;
  }
}

document.addEventListener("click", e => {
  const z = e.target.closest("[data-zoom]");
  if (z) { $("zoomImg").src = z.dataset.zoom; show("zoom", true); return; }
  const a = e.target.closest("[data-a]");
  if (!a) return;
  if (a.dataset.a === "confirm") confirmDelivery();
  if (a.dataset.a === "again") resetAll();
  if (a.dataset.a === "copy" && dispatch) copyText(dispatch.address || "", x("copied"));
});

$("zoom").addEventListener("click", () => show("zoom", false));
document.addEventListener("visibilitychange", () => { if (document.hidden) stopScan(); });
window.addEventListener("pagehide", stopScan);
window.addEventListener("langchange", () => {
  if (dispatch) renderInfo();
  if (verified) renderProof();
});

setDevice();
initLang();

const params = new URLSearchParams(location.search);
const urlD = params.get("d");
const urlC = params.get("code");
if (urlD || urlC) history.replaceState({}, "", location.pathname);
if (urlC) pendingCustomer = urlC;
let savedCode = "";
try { savedCode = localStorage.getItem(KEY) || ""; } catch (e) {}
const first = urlD || savedCode;
if (first) {
  $("dcIn").value = first.toUpperCase();
  openDispatch(first);
} else if (urlC) {
  setMsg("dMsg", x("needD"), "bad");
}
