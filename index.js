import { supabase, must } from "./supabase.js";
import { showLoading, hideLoading } from "./loading.js";
import { t, getLang, initLang, esc, naira, telHref, thumb, toast, km, branchStatus, loadMap, tiles, setDevice, approxLocation } from "./pub.js";

const ghosts = {};
const $ = id => {
  const el = document.getElementById(id);
  if (el) return el;
  if (!ghosts[id]) { ghosts[id] = document.createElement("div"); console.error("Missing element id:", id); }
  return ghosts[id];
};

const LIMIT = 60;
const MORE = 24;
const BUCKET = "Audio_url";

const IMG = {
  sachet: "https://i.imgur.com/gh63h20.png",
  bottle: "https://i.imgur.com/GNmZBuL.png",
  soda: "https://i.imgur.com/n9hXIkG.png",
  carton: "https://i.imgur.com/MX49i4K.png"
};

const X = {
  en: {
    search: "Search products", copied: "Link copied", stext: "Fresh drinks and U-Fresh water by the carton at Hamstore.", post: "Making your poster...", all: "All", water: "Water", drinks: "Drinks", add: "Add", cartons: "cartons", none: "No product found.",
    pick: "Choose a product, type how many cartons, and watch your total grow before you pay.",
    upl: "Uploading your report...", upfail: "Could not upload the voice note. Try again.",
    addr: "Your address", voice: "Voice note", ip: "IP address", sent: "Sent", noaddr: "Not available", live: "LIVE", closed: "SHOP CLOSED"
  },
  ha: {
    search: "Nemi kaya", copied: "An kwafi hanyar shafi", stext: "Lemuka da ruwan U-Fresh da kwali a Hamstore.", post: "Ana yin fosta...", all: "Duka", water: "Ruwa", drinks: "Lemuka", add: "Ƙara", cartons: "kwali", none: "Ba a sami kaya ba.",
    pick: "Zaɓi kaya, rubuta yawan kwali, ka ga jimlar kuɗi tana ƙaruwa kafin ka biya.",
    upl: "Ana aika rahotonka...", upfail: "An kasa loda saƙon murya. Sake gwadawa.",
    addr: "Adireshinka", voice: "Saƙon murya", ip: "IP ɗinka", sent: "An aika", noaddr: "Babu", live: "KAI TSAYE", closed: "SHAGO A RUFE"
  }
};
const x = k => (X[getLang()] || X.en)[k] ?? k;

let posts = [];
let branches = [];
let phones = [];
let cart = {};
let older = { more: false };
let spotIdx = 0;
let spotTimer = 0;
let busyMore = false;
let query = "";
let promo = "";
let newIds = new Set();
let shopOpen = true;
let userLoc = null;
let nearestId = "";
const dmap = {};

const normPost = r => ({ ...r, price: Number(r.price) || 0, createdAt: Number(r.created_at) || 0 });
const normBranch = r => ({ ...r, createdAt: Number(r.created_at) || 0 });
const unitLabel = () => t("cart.carton");
const isWater = p => p.category === "Water";

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem("hs_cart") || "{}") || {};
    cart = {};
    Object.keys(raw).forEach(id => {
      const s = raw[id];
      if (/^POST\d{4,}$/.test(id) && s && Number.isInteger(s.q) && s.q >= 1 && s.q <= 999) cart[id] = { q: s.q, n: String(s.n || ""), p: Number(s.p) || 0, u: "Carton", i: String(s.i || "") };
    });
  } catch (e) { cart = {}; }
}
const saveCart = () => { try { localStorage.setItem("hs_cart", JSON.stringify(cart)); } catch (e) {} };

const lineText = s => `${s.q} × ${naira(s.p)} = <b>${naira(s.p * s.q)}</b>`;

function ctlHTML(id) {
  if (!shopOpen) return `<span class="lockd"><i class="fa-solid fa-lock"></i>${esc(t("card.visit"))}</span>`;
  const s = cart[id];
  if (!s) return `<button class="add" type="button" data-add="${esc(id)}"><i class="fa-solid fa-plus"></i>${esc(x("add"))}</button>`;
  return `<div class="stp"><button type="button" data-d="-1" data-id="${esc(id)}" aria-label="-">−</button><input type="text" inputmode="numeric" maxlength="3" value="${s.q}" data-qi="${esc(id)}" aria-label="Quantity"><button type="button" data-d="1" data-id="${esc(id)}" aria-label="+">+</button></div><div class="sub">${lineText(s)}</div>`;
}

function cardHTML(p) {
  const on = shopOpen && !!cart[p.id];
  return `<article class="pc${on ? " sel" : ""}${shopOpen ? "" : " locked"}" data-id="${esc(p.id)}">
    <div class="pimg"><img loading="lazy" decoding="async" src="${esc(thumb(p.image, "m"))}" alt="${esc(p.name)}"><span class="tag">${esc(unitLabel())}</span>${newIds.has(p.id) ? '<span class="new">NEW</span>' : ""}<span class="tick"><i class="fa-solid fa-check"></i></span></div>
    <div class="pb"><h3>${esc(p.name)}</h3><div class="prow"><div class="pp">${naira(p.price)}</div><div class="sh"><button type="button" data-share="${esc(p.id)}" aria-label="Share"><i class="fa-brands fa-whatsapp"></i></button><button type="button" data-poster="${esc(p.id)}" aria-label="Poster"><i class="fa-solid fa-image"></i></button></div></div><div class="ctl">${ctlHTML(p.id)}</div></div></article>`;
}

function syncCards(id, full = true) {
  document.querySelectorAll(`.pc[data-id="${id}"]`).forEach(c => {
    const on = !!cart[id] && shopOpen;
    c.classList.toggle("sel", on);
    if (full) {
      c.querySelector(".ctl").innerHTML = ctlHTML(id);
    } else {
      const sub = c.querySelector(".sub");
      if (sub && cart[id]) sub.innerHTML = lineText(cart[id]);
    }
  });
}

let shownTotal = 0;
let totalRaf = 0;
function animateTotal(to) {
  cancelAnimationFrame(totalRaf);
  const from = shownTotal;
  const t0 = performance.now();
  const el = $("dTotal");
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
  const step = ts => {
    const k = Math.min(1, (ts - t0) / 450);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    el.textContent = naira(v);
    if (k < 1) totalRaf = requestAnimationFrame(step);
    else shownTotal = to;
  };
  totalRaf = requestAnimationFrame(step);
}

function renderDock() {
  const ids = Object.keys(cart);
  const dock = $("dock");
  if (!shopOpen) {
    dock.classList.remove("on", "open");
    document.body.classList.remove("dockon");
    $("cartCount").textContent = "";
    return;
  }
  dock.classList.toggle("on", ids.length > 0);
  document.body.classList.toggle("dockon", ids.length > 0);
  $("cartCount").textContent = ids.length || "";
  if (!ids.length) { dock.classList.remove("open"); shownTotal = 0; return; }
  let total = 0;
  let cartons = 0;
  ids.forEach(id => { total += cart[id].p * cart[id].q; cartons += cart[id].q; });
  $("dCount").textContent = `${ids.length} · ${cartons} ${x("cartons")}`;
  animateTotal(total);
  $("dMini").innerHTML = ids.map(id => {
    const s = cart[id];
    return `<div class="dl"><img src="${esc(thumb(s.i, "t"))}" alt=""><span class="dn2">${esc(s.n)}</span><em>${s.q} × ${naira(s.p)}</em><b>${naira(s.p * s.q)}</b></div>`;
  }).join("");
  $("dPay").href = "buy.html?items=" + encodeURIComponent(ids.map(id => id + ":" + cart[id].q).join(","));
}

function addItem(id) {
  if (!shopOpen) { showNearest(); return; }
  const p = posts.find(z => z.id === id);
  if (!p || cart[id]) return;
  cart[id] = { q: 1, n: p.name, p: p.price, u: "Carton", i: p.image };
  saveCart();
  syncCards(id);
  renderDock();
}

function removeItem(id) {
  delete cart[id];
  saveCart();
  syncCards(id);
  renderDock();
}

function setQty(id, q, light) {
  if (!cart[id]) return;
  cart[id].q = Math.max(1, Math.min(999, q));
  saveCart();
  syncCards(id, !light);
  renderDock();
}

document.addEventListener("click", e => {
  const shr = e.target.closest("[data-share]");
  if (shr) { shareProduct(shr.dataset.share); return; }
  const pst = e.target.closest("[data-poster]");
  if (pst) { makePoster(pst.dataset.poster); return; }
  const add = e.target.closest("[data-add]");
  if (add) { addItem(add.dataset.add); return; }
  const st = e.target.closest("[data-d]");
  if (st) {
    const id = st.dataset.id;
    const next = (cart[id] ? cart[id].q : 0) + Number(st.dataset.d);
    if (next < 1) removeItem(id);
    else setQty(id, next, false);
    return;
  }
  const img = e.target.closest(".pimg");
  if (img) {
    const card = img.closest(".pc");
    if (card && !cart[card.dataset.id]) addItem(card.dataset.id);
  }
});

document.addEventListener("input", e => {
  const inp = e.target.closest("[data-qi]");
  if (!inp) return;
  inp.value = inp.value.replace(/\D/g, "").slice(0, 3);
  const v = parseInt(inp.value, 10);
  if (v >= 1) setQty(inp.dataset.qi, v, true);
});

document.addEventListener("focusout", e => {
  const inp = e.target.closest && e.target.closest("[data-qi]");
  if (!inp) return;
  const id = inp.dataset.qi;
  if (!cart[id]) return;
  const v = parseInt(inp.value, 10);
  if (!(v >= 1)) inp.value = cart[id].q;
});

function renderPosts() {
  newIds = posts.length > 6 ? new Set([...posts].sort((a, c) => c.createdAt - a.createdAt).filter(p => p.createdAt).slice(0, 3).map(p => p.id)) : new Set();
  const q = query.trim().toLowerCase();
  document.body.classList.toggle("searching", !!q);
  $("catSearch").placeholder = x("search");
  $("mWater").hidden = !posts.some(isWater);
  $("mDrinks").hidden = !posts.some(p => !isWater(p));
  if (q) {
    const list = posts.filter(p => String(p.name).toLowerCase().includes(q));
    $("found").hidden = false;
    $("fGrid").innerHTML = list.map(cardHTML).join("");
    $("fEmpty").hidden = !!list.length;
    $("fEmpty").textContent = x("none");
    return;
  }
  $("found").hidden = true;
  const water = posts.filter(isWater);
  const drinks = posts.filter(p => !isWater(p));
  const n = drinks.length;
  let i = 0;
  const take = c => { const s = drinks.slice(i, i + c); i += c; return s; };
  const mq = take(Math.min(12, Math.ceil(n * 0.4)));
  const ps = take(Math.min(10, Math.ceil(n * 0.25)));
  const tk = take(Math.min(8, Math.ceil(n * 0.2)));
  const rest = drinks.slice(i);
  const fill = (id, secId, list) => { $(secId).hidden = !list.length; $(id).innerHTML = list.map(cardHTML).join(""); };
  fill("wGrid", "water", water);
  fill("mq", "drinks", mq);
  fill("ps", "picks", ps);
  fill("tGrid", "deals", tk);
  fill("mGrid", "all", rest);
  $("moreBtn").hidden = !older.more;
  $("mWater").hidden = !water.length;
  $("mDrinks").hidden = !mq.length;
  observeReveal();
}

let searchT = 0;
$("catSearch").addEventListener("input", e => {
  clearTimeout(searchT);
  searchT = setTimeout(() => { query = e.target.value; renderPosts(); }, 150);
});

function branchCard(b) {
  const st = branchStatus(b);
  const ph = [b.phone, b.phone2, b.phone3].filter(Boolean);
  return `<article class="bc rv" data-id="${esc(b.id)}">
    <div class="bi" data-a="view"><img loading="lazy" decoding="async" src="${esc(thumb(b.image, "l"))}" alt="${esc(b.name)}">${st ? `<span class="stt ${st}">${esc(t(st === "open" ? "br.open" : "br.closed"))}</span>` : ""}${b.id === nearestId ? `<span class="nearr"><i class="fa-solid fa-location-crosshairs"></i> ${esc(t("br.nearest"))}</span>` : ""}</div>
    <div class="bd"><h3 data-a="view">${esc(b.name)}</h3>${typeof dmap[b.id] === "number" ? `<p class="dist"><i class="fa-solid fa-route"></i> ${esc(t("br.away", { km: dmap[b.id].toFixed(1) }))}</p>` : ""}
      <p class="ad"><i class="fa-solid fa-location-dot"></i>${esc(b.address)}</p>
      ${ph.length ? `<div class="phs">${ph.map(n => `<a href="${telHref(n)}"><i class="fa-solid fa-phone"></i>${esc(n)}</a>`).join("")}</div>` : ""}
      <div class="ac"><button class="m" type="button" data-a="map"><i class="fa-solid fa-map-location-dot"></i>${esc(t("br.map"))}</button><button class="r" type="button" data-a="report"><i class="fa-solid fa-microphone-lines"></i>${esc(t("br.report"))}</button></div>
    </div></article>`;
}

function renderBranches() {
  $("branches").hidden = !branches.length;
  $("mBranches").hidden = !branches.length;
  const ordered = userLoc && Object.keys(dmap).length ? [...branches].sort((a, c) => (dmap[a.id] ?? 1e9) - (dmap[c.id] ?? 1e9)) : branches;
  $("bGrid").innerHTML = ordered.map(branchCard).join("");
  observeReveal();
  renderSpot();
}

$("bGrid").addEventListener("click", e => {
  const el = e.target.closest("[data-a]");
  if (!el || e.target.closest(".phs")) return;
  const id = el.closest(".bc").dataset.id;
  if (el.dataset.a === "report") openReport(id);
  else openBranch(id);
});

function renderSpot() {
  clearInterval(spotTimer);
  $("spot").hidden = !branches.length;
  if (!branches.length) return;
  const show = () => {
    const b = branches[spotIdx % branches.length];
    const img = $("spImg");
    img.style.opacity = 0;
    setTimeout(() => { img.src = thumb(b.image, "l"); img.alt = b.name; img.style.opacity = 1; }, 250);
    $("spName").textContent = b.name;
    $("spAd").textContent = b.address;
    $("spImgBox").dataset.id = b.id;
    $("spOpen").dataset.id = b.id;
  };
  show();
  if (branches.length > 1) spotTimer = setInterval(() => { if (!document.hidden) { spotIdx++; show(); } }, 8000);
}
$("spImgBox").addEventListener("click", () => openBranch($("spImgBox").dataset.id));
$("spOpen").addEventListener("click", () => openBranch($("spOpen").dataset.id));

const stack = [];
function ovOpen(el) {
  el.classList.add("on");
  document.body.classList.add("lock");
  history.pushState({ ov: 1 }, "");
  stack.push(el);
}
function ovPop() {
  const el = stack.pop();
  if (!el) return;
  el.classList.remove("on");
  if (!stack.length) document.body.classList.remove("lock");
  el.dispatchEvent(new Event("ovclose"));
}
window.addEventListener("popstate", ovPop);
const back = () => { if (stack.length) history.back(); };

let bvMap = null;
let bvTimer = 0;
const dotIcon = (L, c) => L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11], html: `<div class="pdot" style="--c:${c}"><i></i><b></b></div>` });

async function routeTo(a, b) {
  try {
    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`);
    const j = await r.json();
    const rt = j.routes && j.routes[0];
    if (!rt) throw new Error("none");
    return { pts: rt.geometry.coordinates.map(c => [c[1], c[0]]), km: rt.distance / 1000, min: Math.max(1, Math.round(rt.duration / 60)) };
  } catch (e) {
    const d = km(a, b);
    return { pts: [[a.lat, a.lng], [b.lat, b.lng]], km: d, min: Math.max(1, Math.round((d / 30) * 60)) };
  }
}

async function openBranch(id) {
  const b = branches.find(z => z.id === id);
  if (!b) return;
  const ov = $("bv");
  $("bvTitle").textContent = b.name;
  $("bvImg").src = thumb(b.image, "h");
  $("bvImg").alt = b.name;
  $("bvAd").innerHTML = `<i class="fa-solid fa-location-dot"></i>${esc(b.address)}`;
  const st = branchStatus(b);
  $("bvSt").className = "stt" + (st ? " " + st : "");
  $("bvSt").textContent = st ? t(st === "open" ? "br.open" : "br.closed") : "";
  $("bvHr").textContent = b.opens && b.closes ? t("br.hours", { o: b.opens, c: b.closes }) : "";
  $("bvPh").innerHTML = [b.phone, b.phone2, b.phone3].filter(Boolean).map(n => `<a href="${telHref(n)}"><i class="fa-solid fa-phone"></i>${esc(n)}</a>`).join("");
  $("bvDir").href = `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`;
  $("bvRep").dataset.id = b.id;
  $("bvMsg").textContent = t("bv.finding");
  $("bvSub").textContent = b.name;
  ov.querySelector(".ovbody").scrollTop = 0;
  ovOpen(ov);

  const L = await loadMap();
  if (!stack.includes(ov)) return;
  if (bvMap) { bvMap.remove(); bvMap = null; }
  clearInterval(bvTimer);
  const target = { lat: b.lat, lng: b.lng };
  bvMap = L.map("bvMap", { zoomControl: true, tap: true }).setView([b.lat, b.lng], 16);
  tiles(L).addTo(bvMap);
  const map = bvMap;
  L.marker([b.lat, b.lng], { icon: dotIcon(L, "#e03a3a") }).addTo(map).bindPopup(`<b>${esc(b.name)}</b><br>${esc(b.address)}`).openPopup();
  setTimeout(() => map.invalidateSize(), 350);

  if (!navigator.geolocation) { $("bvMsg").textContent = t("bv.noloc"); return; }
  navigator.geolocation.getCurrentPosition(async pos => {
    if (bvMap !== map) return;
    const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    L.marker([me.lat, me.lng], { icon: dotIcon(L, "#2f7bff") }).addTo(map).bindTooltip(t("bv.you"));
    const r = await routeTo(me, target);
    if (bvMap !== map) return;
    $("bvMsg").textContent = t("bv.dist", { km: r.km.toFixed(1), min: r.min });
    const line = L.polyline([], { color: "#e03a3a", weight: 6, opacity: 0.95, className: "route" }).addTo(map);
    const step = Math.max(1, Math.ceil(r.pts.length / 70));
    let k = 0;
    bvTimer = setInterval(() => {
      k = Math.min(r.pts.length, k + step);
      line.setLatLngs(r.pts.slice(0, k));
      if (k >= r.pts.length) clearInterval(bvTimer);
    }, 28);
    map.fitBounds(L.latLngBounds([[me.lat, me.lng], [b.lat, b.lng]]).pad(0.25));
  }, () => {
    if (bvMap === map) $("bvMsg").textContent = t("bv.noloc");
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}

$("bvBack").onclick = back;
$("bv").addEventListener("ovclose", () => {
  clearInterval(bvTimer);
  if (bvMap) { bvMap.remove(); bvMap = null; }
});
$("bvRep").onclick = () => openReport($("bvRep").dataset.id);

let rec = null, chunks = [], stream = null, blob = null, recT = 0, recS = 0, kind = "stock", where = null, rpBranch = "";

const fmtT = s => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

function micReset() {
  clearInterval(recT);
  if (stream) stream.getTracks().forEach(z => z.stop());
  stream = null; rec = null; blob = null; chunks = [];
  $("mic").className = "mic";
  $("mic").innerHTML = '<i class="fa-solid fa-microphone"></i>';
  $("micT").textContent = "0:00";
  $("micS").textContent = t("rp.mic0");
  $("micA").hidden = true;
  $("micA").removeAttribute("src");
  $("micR").hidden = true;
}

async function startRec() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    return toast("error", t("e.mic"));
  }
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find(z => window.MediaRecorder && MediaRecorder.isTypeSupported(z)) || "";
  try {
    rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 24000 });
  } catch (e) {
    stream.getTracks().forEach(z => z.stop());
    return toast("error", t("e.mic"));
  }
  chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    clearInterval(recT);
    stream.getTracks().forEach(z => z.stop());
    blob = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
    $("mic").className = "mic done";
    $("mic").innerHTML = '<i class="fa-solid fa-check"></i>';
    $("micS").textContent = t("rp.mic2");
    $("micA").src = URL.createObjectURL(blob);
    $("micA").hidden = false;
    $("micR").hidden = false;
  };
  rec.start();
  recS = 0;
  $("mic").className = "mic rec";
  $("mic").innerHTML = '<i class="fa-solid fa-stop"></i>';
  $("micS").textContent = t("rp.mic1");
  recT = setInterval(() => {
    recS++;
    $("micT").textContent = fmtT(recS);
    if (recS >= 90) rec.stop();
  }, 1000);
}

$("mic").onclick = () => {
  if (rec && rec.state === "recording") rec.stop();
  else if (!blob) startRec();
};
$("micR").onclick = () => { micReset(); startRec(); };

$("rpTypes").querySelectorAll(".tp").forEach(b => b.onclick = () => {
  kind = b.dataset.k;
  $("rpTypes").querySelectorAll(".tp").forEach(z => z.setAttribute("aria-pressed", String(z === b)));
});

function locText() {
  if (!where) return "";
  const near = branches.filter(b => typeof b.lat === "number").map(b => ({ b, d: km(where, b) })).sort((a, c) => a.d - c.d)[0];
  return t("rp.locok") + (near ? " " + t("rp.near", { b: near.b.name, km: near.d.toFixed(1) }) : "");
}

$("rpLoc").onclick = () => {
  if (!navigator.geolocation) return ($("rpLocS").textContent = t("rp.locno"));
  $("rpLocS").textContent = t("rp.locwait");
  navigator.geolocation.getCurrentPosition(pos => {
    where = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    $("rpLocS").textContent = locText();
  }, () => { where = null; $("rpLocS").textContent = t("rp.locno"); }, { enableHighAccuracy: true, timeout: 15000 });
};

function openReport(branchId) {
  rpBranch = branchId || "";
  const b = branches.find(z => z.id === rpBranch);
  $("rpAt").hidden = !b;
  if (b) $("rpAt").textContent = t("rp.at", { b: b.name });
  $("rpForm").hidden = false;
  $("rpOk").hidden = true;
  if (!stack.includes($("rp"))) ovOpen($("rp"));
}

$("rpBack").onclick = back;
$("rp").addEventListener("ovclose", micReset);
$("rpNew").onclick = () => { micReset(); $("rpText").value = ""; $("rpForm").hidden = false; $("rpOk").hidden = true; };

async function uploadAudio(b) {
  const mime = (b.type || "audio/webm").split(";")[0];
  const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  const path = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, b, { contentType: mime, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function getAddress(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=${getLang()}`);
    const j = await r.json();
    return j.display_name || "";
  } catch (e) { return ""; }
}

async function getIP() {
  try {
    const r = await fetch("https://api.ipify.org?format=json");
    const j = await r.json();
    return j.ip || "";
  } catch (e) { return ""; }
}

$("rpSend").onclick = async () => {
  if (rec && rec.state === "recording") rec.stop();
  const name = $("rpName").value.trim();
  const phone = $("rpPhone").value.trim();
  const message = $("rpText").value.trim();
  if (name.length < 2) return toast("error", t("e.name"));
  if (!/^[0-9+\s-]{7,20}$/.test(phone)) return toast("error", t("e.phone"));
  await new Promise(r => setTimeout(r, 250));
  if (!message && !blob) return toast("error", t("e.empty"));
  showLoading(x("upl"));
  try {
    if (!where) { try { where = await getPos(8000); } catch (e) { where = null; } }
    let audioUrl = "";
    let address = "";
    let ip = "";
    try {
      [audioUrl, address, ip] = await Promise.all([
        blob ? uploadAudio(blob) : Promise.resolve(""),
        where ? getAddress(where.lat, where.lng) : Promise.resolve(""),
        getIP()
      ]);
    } catch (e) {
      hideLoading();
      return toast("error", x("upfail"));
    }
    const body = { name, phone, kind, message, branchId: rpBranch, audioUrl, audio_url: audioUrl, address, ip };
    if (where) { body.lat = where.lat; body.lng = where.lng; }
    const res = await fetch("/api/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    if (j.ok) {
      $("rpRef").textContent = j.ref;
      const rows = [];
      if (audioUrl) rows.push(`<div><i class="fa-solid fa-microphone"></i><span>${esc(x("voice"))}</span><b>${esc(x("sent"))}</b></div>`);
      rows.push(`<div><i class="fa-solid fa-location-dot"></i><span>${esc(x("addr"))}</span><b>${esc(address || x("noaddr"))}</b></div>`);
      rows.push(`<div><i class="fa-solid fa-network-wired"></i><span>${esc(x("ip"))}</span><b>${esc(ip || x("noaddr"))}</b></div>`);
      $("rpSum").innerHTML = rows.join("");
      $("rpForm").hidden = true;
      $("rpOk").hidden = false;
      $("rpOk").scrollIntoView({ block: "start" });
      $("rpText").value = "";
      micReset();
    } else {
      toast("error", j.code === "wait" ? t("e.wait") : j.code === "phone" ? t("e.phone") : j.code === "audio" ? t("e.long") : t("e.server"));
    }
  } catch (e) {
    toast("error", t("err.net"));
  } finally {
    hideLoading();
  }
};

$("heroReport").onclick = () => openReport("");
$("bandReport").onclick = () => openReport("");
$("mReport").onclick = () => { closeMenu(); setTimeout(() => openReport(""), 280); };

const menu = $("mnu");
function openMenu() {
  menu.hidden = false;
  document.body.classList.add("lock");
  requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add("on")));
  $("menuX").focus();
}
function closeMenu() {
  menu.classList.remove("on");
  if (!stack.length) document.body.classList.remove("lock");
  setTimeout(() => { if (!menu.classList.contains("on")) menu.hidden = true; }, 300);
}
$("menuBtn").onclick = openMenu;
$("menuX").onclick = closeMenu;
document.addEventListener("keydown", e => { if (e.key === "Escape" && menu.classList.contains("on")) closeMenu(); });

document.querySelectorAll("[data-go]").forEach(a => a.addEventListener("click", e => {
  const target = document.querySelector(a.getAttribute("href"));
  if (!target) return;
  e.preventDefault();
  const inMenu = menu.contains(a);
  if (inMenu) closeMenu();
  setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), inMenu ? 300 : 0);
}));

$("cartBtn").onclick = () => {
  if (!Object.keys(cart).length) return toast("ok", t("buy.empty"));
  $("dock").classList.toggle("open");
};
$("dTg").onclick = () => $("dock").classList.toggle("open");
$("dClr").onclick = () => {
  const ids = Object.keys(cart);
  cart = {};
  saveCart();
  ids.forEach(id => syncCards(id));
  renderDock();
};

let io = null;
function observeReveal() {
  if (!io) io = new IntersectionObserver(en => en.forEach(z => { if (z.isIntersecting) { z.target.classList.add("in"); io.unobserve(z.target); } }), { rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll(".rv:not(.in)").forEach(el => io.observe(el));
}

function mergePosts(rows) {
  const map = new Map(posts.map(p => [p.id, p]));
  rows.forEach(p => { if (p && p.id && !map.has(p.id)) map.set(p.id, p); });
  posts = [...map.values()];
}

async function loadPosts() {
  const rows = (must(await supabase.from("posts").select("*").order("created_at", { ascending: false }).range(0, LIMIT - 1)) || []).map(normPost);
  posts = [];
  mergePosts(rows);
  older = { more: rows.length >= LIMIT };
  posts.forEach(p => { if (cart[p.id]) Object.assign(cart[p.id], { n: p.name, p: p.price, u: "Carton", i: p.image }); });
  saveCart();
}

async function loadMore() {
  if (busyMore || !older.more) return;
  busyMore = true;
  try {
    const from = posts.length;
    const rows = (must(await supabase.from("posts").select("*").order("created_at", { ascending: false }).range(from, from + MORE - 1)) || []).map(normPost);
    older.more = rows.length >= MORE;
    const before = posts.length;
    mergePosts(rows);
    if (posts.length === before) older.more = false;
    renderPosts();
  } catch (e) {
    toast("error", t("err.net"));
  } finally {
    busyMore = false;
  }
}
$("moreBtn").onclick = loadMore;

async function loadBranches() {
  const rows = (must(await supabase.from("branches").select("*").order("created_at", { ascending: false }).limit(40)) || []).map(normBranch);
  branches = rows.filter(b => typeof b.lat === "number" && typeof b.lng === "number");
}

async function loadPhones() {
  const rows = must(await supabase.from("phones").select("*").order("created_at", { ascending: true })) || [];
  phones = rows.filter(p => p && p.number);
  $("ftPhones").innerHTML = phones.map(p => `<a href="${telHref(p.number)}"><i class="fa-solid fa-phone"></i>${esc(p.label)}: ${esc(p.number)}</a>`).join("");
  $("parPhones").insertAdjacentHTML("afterbegin", phones.map(p => `<a class="bt" href="${telHref(p.number)}"><i class="fa-solid fa-phone"></i>${esc(p.label)}: ${esc(p.number)}</a>`).join(""));
}

function renderAll() {
  shopUI();
  renderStatic();
  renderBranches();
  renderPosts();
  renderDock();
  observeReveal();
}

window.addEventListener("langchange", renderAll);

setDevice();
let rz = 0;
addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(setDevice, 150); });
let progTick = 0;
addEventListener("scroll", () => {
  $("hd").classList.toggle("solid", scrollY > 20);
  $("toTop").classList.toggle("on", scrollY > 700);
  if (progTick) return;
  progTick = requestAnimationFrame(() => {
    progTick = 0;
    const h = document.documentElement.scrollHeight - innerHeight;
    $("prog").style.transform = `scaleX(${h > 0 ? Math.min(1, scrollY / h) : 0})`;
  });
}, { passive: true });
$("toTop").addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));
$("yr").textContent = new Date().getFullYear();

const hshow = $("hshow");
const hcard = $("hcard");
if (matchMedia("(hover:hover)").matches && !matchMedia("(prefers-reduced-motion:reduce)").matches) {
  hshow.addEventListener("pointermove", e => {
    const r = hshow.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    hcard.style.transform = `rotateY(${px * 10}deg) rotateX(${-py * 8}deg)`;
  });
  hshow.addEventListener("pointerleave", () => { hcard.style.transform = ""; });
}

const getPos = (timeout = 12000) => new Promise((res, rej) => {
  if (!navigator.geolocation) return rej(new Error("none"));
  navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), rej, { enableHighAccuracy: true, timeout, maximumAge: 60000 });
});

async function locate(ask) {
  if (userLoc && userLoc.exact) return userLoc;
  try {
    let allowed = ask;
    if (!allowed && navigator.permissions && navigator.permissions.query) {
      const st = await navigator.permissions.query({ name: "geolocation" });
      allowed = st.state === "granted";
    }
    if (allowed) {
      const p = await getPos();
      userLoc = { ...p, exact: true };
      return userLoc;
    }
  } catch (e) {}
  if (!userLoc) {
    const a = await approxLocation();
    if (a) userLoc = { ...a, exact: false };
  }
  return userLoc;
}

function updateDistances() {
  if (!userLoc || !branches.length) return;
  branches.forEach(b => { dmap[b.id] = km(userLoc, b); });
  nearestId = [...branches].sort((a, c) => dmap[a.id] - dmap[c.id])[0].id;
  renderBranches();
}

function shopUI() {
  document.body.classList.toggle("closed", !shopOpen);
  $("closedBar").hidden = shopOpen;
  $("mOrder").hidden = !shopOpen;
  $("cartBtn").hidden = !shopOpen;
  $("hLive").textContent = shopOpen ? x("live") : x("closed");
  $("hcard").classList.toggle("off", !shopOpen);
  const sub = $("drinksSub");
  sub.dataset.i18n = shopOpen ? "drinks.sub" : "drinks.sub.closed";
  sub.textContent = t(sub.dataset.i18n);
}

function closeNearest() {
  $("nb").hidden = true;
  if (!stack.length && !$("mnu").classList.contains("on")) document.body.classList.remove("lock");
}

function renderNearest(loc) {
  const body = $("nbBody");
  const list = loc ? branches.map(b => ({ b, d: km(loc, b) })).sort((a, c) => a.d - c.d) : [];
  if (!list.length) {
    body.innerHTML = `<p class="s">${esc(t("nb.none"))}</p><a class="bt" href="tel:08060767279"><i class="fa-solid fa-phone"></i>08060767279</a>`;
    return;
  }
  const { b, d } = list[0];
  const st = branchStatus(b);
  const ph = [b.phone, b.phone2, b.phone3].filter(Boolean);
  body.innerHTML = `<div class="nbi"><img src="${esc(thumb(b.image, "l"))}" alt="${esc(b.name)}"></div>
    <h4>${esc(b.name)}</h4>
    <p class="ad"><i class="fa-solid fa-location-dot"></i>${esc(b.address)}</p>
    <div class="nbtags"><span class="nbd">${esc(t("nb.dist", { km: d.toFixed(1) }))}</span>${st ? `<span class="stt ${st}">${esc(t(st === "open" ? "br.open" : "br.closed"))}</span>` : ""}</div>
    ${loc.exact ? "" : `<p class="small">${esc(t("nb.approx"))}</p><button class="tp" id="nbExact" type="button"><i class="fa-solid fa-location-crosshairs"></i> ${esc(t("nb.exact"))}</button>`}
    ${ph.length ? `<div class="phs">${ph.map(n => `<a href="${telHref(n)}"><i class="fa-solid fa-phone"></i>${esc(n)}</a>`).join("")}</div>` : ""}
    <div class="btns"><button class="bt" id="nbMap" type="button" data-id="${esc(b.id)}"><i class="fa-solid fa-map-location-dot"></i><span>${esc(t("nb.view"))}</span></button></div>`;
}

async function showNearest() {
  $("nb").hidden = false;
  document.body.classList.add("lock");
  $("nbBody").innerHTML = `<p class="nbwait"><i class="fa-solid fa-location-crosshairs fa-beat"></i> ${esc(t("nb.finding"))}</p>`;
  const loc = await locate(true);
  updateDistances();
  if (!$("nb").hidden) renderNearest(loc);
}

$("nbX").addEventListener("click", closeNearest);
$("nb").addEventListener("click", e => { if (e.target === $("nb")) closeNearest(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("nb").hidden) closeNearest(); });
$("nbBody").addEventListener("click", async e => {
  if (e.target.closest("#nbMap")) {
    const id = e.target.closest("#nbMap").dataset.id;
    closeNearest();
    openBranch(id);
  }
  if (e.target.closest("#nbExact")) {
    userLoc = null;
    $("nbBody").innerHTML = `<p class="nbwait"><i class="fa-solid fa-location-crosshairs fa-beat"></i> ${esc(t("nb.finding"))}</p>`;
    const loc = await locate(true);
    updateDistances();
    if (!$("nb").hidden) renderNearest(loc);
  }
});
$("cbNear").addEventListener("click", showNearest);

async function loadShop() {
  const row = must(await supabase.from("settings").select("value").eq("key", "shop_open").maybeSingle());
  shopOpen = !row || row.value !== "no";
}

function watchShop() {
  supabase
    .channel("shop-open")
    .on("postgres_changes", { event: "*", schema: "public", table: "settings", filter: "key=eq.shop_open" }, payload => {
      const val = payload.new && payload.new.value;
      const open = val !== "no";
      if (open === shopOpen) return;
      shopOpen = open;
      shopUI();
      renderPosts();
      renderDock();
    })
    .subscribe();
}

function initLocation() {
  locate(false).then(l => { if (l) updateDistances(); });
}

const RANGE = [["sachet", "r.sachet", "r.sachet.p"], ["bottle", "r.bottle", "r.bottle.p"], ["soda", "r.soda", "r.soda.p"], ["carton", "r.carton", "r.carton.p"]];
let rangeKey = "sachet";
let statsDone = false;

function renderRange(swap) {
  if (!RANGE.some(r => r[0] === rangeKey)) rangeKey = RANGE[0][0];
  $("rTabs").innerHTML = RANGE.map(([k, name]) => `<button class="rtab" type="button" role="tab" data-k="${k}" aria-selected="${k === rangeKey}"><img class="ti" src="${IMG[k]}" alt="" loading="lazy" decoding="async">${esc(t(name))}</button>`).join("");
  const cur = RANGE.find(r => r[0] === rangeKey) || RANGE[0];
  $("rIll").innerHTML = `<img class="fx" src="${IMG[cur[0]]}" alt="${esc(t(cur[1]))}" decoding="async">`;
  $("rTitle").textContent = t(cur[1]);
  $("rText").textContent = t(cur[2]);
  if (swap) {
    const st = $("rStage");
    st.classList.remove("swap");
    void st.offsetWidth;
    st.classList.add("swap");
  }
}

$("rTabs").addEventListener("click", e => {
  const b = e.target.closest(".rtab");
  if (!b) return;
  rangeKey = b.dataset.k;
  renderRange(true);
});
$("rCta").addEventListener("click", () => openReport(""));

function countUp(el, to) {
  const t0 = performance.now();
  const step = ts => {
    const k = Math.min(1, (ts - t0) / 1400);
    el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderStats() {
  const vals = { stB: branches.length, stP: posts.length, stW: 2 };
  Object.keys(vals).forEach(id => {
    const el = $(id);
    el.dataset.count = vals[id];
    el.closest(".ring").hidden = vals[id] === 0;
    if (statsDone) el.textContent = vals[id] + (id === "stP" && older.more ? "+" : "");
  });
  $("hBr").textContent = branches.length;
  $("hPr").textContent = posts.length + (older.more ? "+" : "");
}

function renderTicker() {
  const items = [[IMG.bottle, "tk.1"], [IMG.sachet, "tk.2"], [IMG.soda, "tk.3"], ["fa-house", "tk.4"], [IMG.carton, "tk.6"], ["fa-store", "tk.7"]];
  const one = items.map(([i, k]) => `<span>${i.indexOf("http") === 0 ? `<img class="tkimg" src="${i}" alt="" loading="lazy" decoding="async">` : `<i class="fa-solid ${i}"></i>`}${esc(t(k))}</span>`).join("");
  const lead = promo ? `<span><i class="fa-solid fa-bullhorn"></i>${esc(promo)}</span>` : "";
  const base = lead + one;
  $("tkTrack").innerHTML = base + base + base + base;
}

function renderStatic() {
  renderTicker();
  renderRange(false);
  renderStats();
}

new IntersectionObserver((en, obs) => {
  if (!en.some(z => z.isIntersecting)) return;
  obs.disconnect();
  statsDone = true;
  document.querySelectorAll(".ring").forEach(r => r.classList.add("in"));
  ["stB", "stP", "stW"].forEach(id => countUp($(id), Number($(id).dataset.count) || 0));
}, { threshold: 0.3 }).observe($("stats"));

new IntersectionObserver((en, obs) => {
  if (en.some(z => z.isIntersecting)) { $("tl").classList.add("in"); obs.disconnect(); }
}, { threshold: 0.25 }).observe($("tl"));

new IntersectionObserver(en => { if (en[0].isIntersecting) loadMore(); }, { rootMargin: "400px" }).observe($("moreBtn"));

function autoScroll(el) {
  let pos = 0, last = 0, paused = false, timer = 0, vis = false;
  const hold = () => { paused = true; pos = el.scrollLeft; clearTimeout(timer); timer = setTimeout(() => { pos = el.scrollLeft; paused = false; }, 3500); };
  ["pointerdown", "touchstart", "wheel", "keydown", "focusin"].forEach(ev => el.addEventListener(ev, hold, { passive: true }));
  new IntersectionObserver(en => { vis = en[0].isIntersecting; }).observe(el);
  const calm = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const tick = ts => {
    if (vis && !paused && !calm && last) {
      pos += (ts - last) * 0.04;
      if (pos >= el.scrollWidth - el.clientWidth - 1) pos = 0;
      el.scrollLeft = pos;
    }
    last = ts;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let fillTick = 0;
function updateFill() {
  fillTick = 0;
  const sec = $("fill");
  const r = sec.getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return;
  const p = Math.max(0, Math.min(1, (innerHeight - r.top) / (innerHeight + r.height * 0.4)));
  sec.style.setProperty("--fill", p.toFixed(3));
  $("fillPct").textContent = Math.round(p * 100) + "%";
}
addEventListener("scroll", () => { if (!fillTick) fillTick = requestAnimationFrame(updateFill); }, { passive: true });

function netCanvas(cv, rgb) {
  const ctx = cv.getContext && cv.getContext("2d");
  if (!ctx) return;
  const calm = matchMedia("(prefers-reduced-motion:reduce)").matches;
  let w = 1, h = 1, nodes = [], vis = false, raf = 0, last = 0;
  const size = () => {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 1.25);
    w = cv.width = Math.max(1, Math.round(r.width * dpr));
    h = cv.height = Math.max(1, Math.round(r.height * dpr));
    const n = Math.round(Math.min(34, Math.max(14, r.width / 36)));
    nodes = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.3 * dpr, vy: (Math.random() - 0.5) * 0.3 * dpr, r: (Math.random() * 1.4 + 0.8) * dpr }));
  };
  const frame = ts => {
    raf = 0;
    if (!vis) return;
    if (ts - last > 45 || calm) {
      last = ts;
      ctx.clearRect(0, 0, w, h);
      nodes.forEach(n => {
        if (!calm) { n.x += n.vx; n.y += n.vy; }
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, 6.2832);
        ctx.fillStyle = `rgba(${rgb},.7)`;
        ctx.fill();
      });
      const lim = (Math.min(w, h) * 0.22) ** 2;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const d = dx * dx + dy * dy;
          if (d < lim) {
            ctx.strokeStyle = `rgba(${rgb},${0.3 * (1 - d / lim)})`;
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }
    }
    if (!calm) raf = requestAnimationFrame(frame);
  };
  new IntersectionObserver(en => {
    vis = en[0].isIntersecting;
    if (vis) { size(); if (!raf) raf = requestAnimationFrame(frame); }
  }).observe(cv);
}

const svIO = new IntersectionObserver(en => en.forEach(z => z.target.classList.toggle("sv", z.isIntersecting)), { rootMargin: "80px" });
document.querySelectorAll(".hero,.sec").forEach(s => svIO.observe(s));
netCanvas($("netHero"), "31,157,92");
netCanvas($("netSpot"), "31,157,92");
netCanvas($("netBand"), "255,255,255");

async function loadPromo() {
  const row = must(await supabase.from("settings").select("value").eq("key", "promo_text").maybeSingle());
  promo = row && row.value ? String(row.value).slice(0, 140) : "";
}

const siteUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");

function shareProduct(id) {
  const p = posts.find(z => z.id === id);
  if (!p) return;
  const text = `${p.name} - ${naira(p.price)} / ${unitLabel()}\nHamstore Integrated Services\n${siteUrl()}`;
  if (navigator.share) navigator.share({ title: p.name, text, url: siteUrl() }).catch(() => {});
  else window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
}

const loadImg = src => new Promise(res => {
  const i = new Image();
  i.crossOrigin = "anonymous";
  i.onload = () => res(i);
  i.onerror = () => res(null);
  i.src = src;
});

function fitText(ctx, text, max) {
  let s = String(text);
  while (ctx.measureText(s).width > max && s.length > 3) s = s.slice(0, -2);
  return s === String(text) ? s : s.trim() + "…";
}

async function makePoster(id) {
  const p = posts.find(z => z.id === id);
  if (!p) return;
  toast("ok", x("post"));
  try { await document.fonts.load("56px Lobster"); } catch (e) {}
  const W = 1080, H = 1350;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const c = cv.getContext("2d");
  const [logo, pic] = await Promise.all([loadImg("https://i.imgur.com/UXH5q5w.png"), loadImg(thumb(p.image, "h")).then(i => i || loadImg(IMG.carton))]);
  c.fillStyle = "#f7f4ec";
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#e03a3a";
  c.beginPath(); c.ellipse(W / 2, -60, 860, 400, 0, 0, 6.2832); c.fill();
  c.fillStyle = "#1f9d5c";
  c.beginPath(); c.ellipse(W / 2, H + 80, 900, 300, 0, 0, 6.2832); c.fill();
  if (logo) { const lh = 130, lw = logo.width / logo.height * lh; c.fillStyle = "#fff"; c.beginPath(); c.roundRect((W - lw) / 2 - 24, 36, lw + 48, lh + 24, 40); c.fill(); c.drawImage(logo, (W - lw) / 2, 48, lw, lh); }
  c.textAlign = "center";
  c.fillStyle = "#fff";
  c.font = "56px Lobster, cursive";
  c.fillText(getLang() === "ha" ? "Sabo daga Hamstore" : "Fresh from Hamstore", W / 2, 270);
  const bx = 150, by = 320, bw = W - 300, bh = 640;
  c.save();
  c.shadowColor = "rgba(0,0,0,.35)"; c.shadowBlur = 40; c.shadowOffsetY = 18;
  c.fillStyle = "#fff"; c.beginPath(); c.roundRect(bx - 14, by - 14, bw + 28, bh + 28, 48); c.fill();
  c.restore();
  c.save();
  c.beginPath(); c.roundRect(bx, by, bw, bh, 36); c.clip();
  if (pic) { const r = Math.max(bw / pic.width, bh / pic.height); const dw = pic.width * r, dh = pic.height * r; c.drawImage(pic, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh); }
  c.restore();
  c.fillStyle = "#e03a3a";
  c.beginPath(); c.ellipse(W - 250, by + bh - 20, 190, 100, -0.06, 0, 6.2832); c.fill();
  c.lineWidth = 8; c.strokeStyle = "#fff"; c.stroke();
  c.fillStyle = "#fff";
  c.font = "800 62px system-ui, sans-serif";
  c.fillText(naira(p.price), W - 250, by + bh - 8);
  c.font = "34px Lobster, cursive";
  c.fillText(unitLabel(), W - 250, by + bh + 36);
  c.fillStyle = "#10261b";
  c.font = "800 62px system-ui, sans-serif";
  c.fillText(fitText(c, p.name, W - 160), W / 2, 1090);
  c.fillStyle = "#fff";
  c.font = "700 44px system-ui, sans-serif";
  c.fillText("08060767279", W / 2, 1210);
  c.font = "34px system-ui, sans-serif";
  c.fillText(location.host, W / 2, 1262);
  cv.toBlob(async b => {
    if (!b) return toast("error", t("err.net"));
    const file = new File([b], "hamstore-" + id + ".png", { type: "image/png" });
    const text = `${p.name} - ${naira(p.price)} / ${unitLabel()}\n${siteUrl()}`;
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, "image/png");
}

$("spWa").onclick = () => window.open("https://wa.me/?text=" + encodeURIComponent(x("stext") + "\n" + siteUrl()), "_blank", "noopener");
$("spShare").onclick = () => {
  if (navigator.share) navigator.share({ title: "Hamstore", text: x("stext"), url: siteUrl() }).catch(() => {});
  else $("spWa").click();
};
$("spCopy").onclick = async () => {
  try { await navigator.clipboard.writeText(siteUrl()); toast("ok", x("copied")); } catch (e) { toast("error", siteUrl()); }
};

loadCart();
initLang();
autoScroll($("mq"));
autoScroll($("ps"));
updateFill();
renderDock();
showLoading(t("loading"));
const bootEl = document.getElementById("boot");
if (bootEl) { bootEl.classList.add("out"); setTimeout(() => bootEl.remove(), 450); }
const all = Promise.allSettled([loadBranches(), loadPosts(), loadPhones(), loadShop(), loadPromo()]);
await Promise.race([all, new Promise(r => setTimeout(r, 3500))]);
hideLoading();
renderAll();
all.then(res => {
  renderAll();
  watchShop();
  initLocation();
  if (res.every(r => r.status === "rejected")) toast("error", t("err.net"));
});
