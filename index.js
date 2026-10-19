import { app } from "./firebase.js";
import { getDatabase, ref, get, query, orderByChild, limitToLast, endBefore } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";
import { showLoading, hideLoading } from "./loading.js";
import { t, initLang, esc, naira, telHref, thumb, toast, km, branchStatus, loadMap, tiles, setDevice } from "./pub.js";

const db = getDatabase(app);
const $ = id => document.getElementById(id);
const LIMIT = 60;
const MORE = 24;

let posts = [];
let branches = [];
let phones = [];
let cart = {};
let older = { key: null, time: null, more: false };
let spotIdx = 0;
let spotTimer = 0;
let busyMore = false;

const unitLabel = u => (u === "Single" ? t("cart.single") : t("cart.carton"));

function loadCart() {
  try {
    const raw = JSON.parse(localStorage.getItem("hs_cart") || "{}") || {};
    cart = {};
    Object.keys(raw).forEach(id => {
      const s = raw[id];
      if (/^POST\d{4,}$/.test(id) && s && Number.isInteger(s.q) && s.q >= 1 && s.q <= 999) cart[id] = { q: s.q, n: String(s.n || ""), p: Number(s.p) || 0, u: s.u === "Single" ? "Single" : "Carton", i: String(s.i || "") };
    });
  } catch (e) { cart = {}; }
}
const saveCart = () => { try { localStorage.setItem("hs_cart", JSON.stringify(cart)); } catch (e) {} };

function qboxInner(id) {
  const s = cart[id];
  if (!s) return "";
  return `<button class="qb" type="button" data-q="${esc(id)}" aria-label="Quantity">${s.q}</button><small>${esc(unitLabel(s.u))} · ${esc(t("cart.line", { p: naira(s.p), q: s.q, s: naira(s.p * s.q) }))}</small>`;
}

function cardHTML(p, style) {
  const on = !!cart[p.id];
  return `<article class="card c-${style}${on ? " sel" : ""}" data-id="${esc(p.id)}" tabindex="0" role="button" aria-pressed="${on}">
    <div class="ph"><img loading="lazy" decoding="async" src="${esc(thumb(p.image, "m"))}" alt="${esc(p.name)}"><span class="tick"><i class="fa-solid fa-check"></i></span><div class="qbox">${qboxInner(p.id)}</div></div>
    <div class="cb"><h3>${esc(p.name)}</h3><div class="pr">${naira(p.price)}</div><span class="un">${esc(unitLabel(p.unit))}</span></div></article>`;
}

function syncCards(id) {
  document.querySelectorAll(`.card[data-id="${id}"]`).forEach(c => {
    const on = !!cart[id];
    c.classList.toggle("sel", on);
    c.setAttribute("aria-pressed", String(on));
    const q = c.querySelector(".qbox");
    if (q) q.innerHTML = qboxInner(id);
  });
}

function renderDock() {
  const ids = Object.keys(cart);
  const dock = $("dock");
  dock.classList.toggle("on", ids.length > 0);
  $("cartCount").textContent = ids.length || "";
  if (!ids.length) { dock.classList.remove("open"); return; }
  let total = 0;
  ids.forEach(id => { total += cart[id].p * cart[id].q; });
  $("dCount").textContent = t("cart.sel", { n: ids.length });
  $("dTotal").textContent = naira(total);
  $("dMini").innerHTML = ids.map(id => `<div class="mini"><img src="${esc(thumb(cart[id].i, "t"))}" alt="${esc(cart[id].n)}"><b>${cart[id].q}</b></div>`).join("");
  $("dPay").href = "buy.html?items=" + encodeURIComponent(ids.map(id => id + ":" + cart[id].q).join(","));
}

function toggle(id) {
  const p = posts.find(x => x.id === id);
  if (cart[id]) delete cart[id];
  else if (p) cart[id] = { q: 1, n: p.name, p: p.price, u: p.unit, i: p.image };
  saveCart();
  syncCards(id);
  renderDock();
}

function setQty(id, q) {
  if (!cart[id]) return;
  cart[id].q = q;
  saveCart();
  syncCards(id);
  renderDock();
}

function editQty(btn) {
  const id = btn.dataset.q;
  const inp = document.createElement("input");
  inp.type = "text";
  inp.inputMode = "numeric";
  inp.maxLength = 3;
  inp.value = cart[id].q;
  btn.replaceWith(inp);
  inp.focus();
  inp.select();
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    const v = parseInt(inp.value, 10);
    setQty(id, v >= 1 ? Math.min(999, v) : cart[id] ? cart[id].q : 1);
  };
  inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, ""); });
  inp.addEventListener("blur", done);
  inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); });
}

document.addEventListener("click", e => {
  const qb = e.target.closest(".qb");
  if (qb) { e.stopPropagation(); editQty(qb); return; }
  if (e.target.closest(".qbox input")) return;
  const card = e.target.closest(".card");
  if (card) toggle(card.dataset.id);
});
document.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("card")) {
    e.preventDefault();
    toggle(e.target.dataset.id);
  }
});

function autoScroll(el) {
  let pos = 0, last = 0, paused = false, timer = 0, vis = false;
  const hold = () => { paused = true; pos = el.scrollLeft; clearTimeout(timer); timer = setTimeout(() => { pos = el.scrollLeft; paused = false; }, 3500); };
  ["pointerdown", "touchstart", "wheel", "keydown", "focusin"].forEach(ev => el.addEventListener(ev, hold, { passive: true }));
  new IntersectionObserver(en => { vis = en[0].isIntersecting; }).observe(el);
  const calm = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const tick = ts => {
    if (vis && !paused && !calm && last) {
      pos += (ts - last) * 0.045;
      if (pos >= el.scrollWidth - el.clientWidth - 1) pos = 0;
      el.scrollLeft = pos;
    }
    last = ts;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderPosts() {
  const water = posts.filter(p => p.category === "Water");
  const drinks = posts.filter(p => p.category !== "Water");
  const n = drinks.length;
  let i = 0;
  const take = c => { const s = drinks.slice(i, i + c); i += c; return s; };
  const mq = take(Math.min(12, Math.ceil(n * 0.4)));
  const ps = take(Math.min(10, Math.ceil(n * 0.25)));
  const tk = take(Math.min(8, Math.ceil(n * 0.2)));
  const rest = drinks.slice(i);

  $("water").hidden = !water.length;
  $("wGrid").innerHTML = water.map(p => cardHTML(p, "bubble")).join("");

  $("drinks").hidden = !mq.length;
  if (mq.length) {
    const reps = Math.max(1, Math.ceil(6 / mq.length));
    const half = Array.from({ length: reps }, () => mq.map(p => cardHTML(p, "glass")).join("")).join("");
    $("mqTrack").innerHTML = half + half;
    $("mqTrack").style.setProperty("--dur", Math.max(26, mq.length * reps * 6) + "s");
  }

  $("picks").hidden = !ps.length;
  $("ps").innerHTML = ps.map(p => cardHTML(p, "pol")).join("");

  $("deals").hidden = !tk.length;
  $("tGrid").innerHTML = tk.map(p => cardHTML(p, "tick")).join("");

  $("all").hidden = !rest.length;
  $("mGrid").innerHTML = rest.map(p => cardHTML(p, "bento")).join("");
  $("moreBtn").hidden = !older.more;

  $("mWater").hidden = !water.length;
  $("mDrinks").hidden = !mq.length;
  renderSpot();
}

function branchCard(b) {
  const st = branchStatus(b);
  const ph = [b.phone, b.phone2, b.phone3].filter(Boolean);
  return `<article class="bc rv" data-id="${esc(b.id)}">
    <div class="bi" data-a="view"><img loading="lazy" decoding="async" src="${esc(thumb(b.image, "l"))}" alt="${esc(b.name)}">${st ? `<span class="stt ${st}">${esc(t(st === "open" ? "br.open" : "br.closed"))}</span>` : ""}</div>
    <div class="bd"><h3 data-a="view">${esc(b.name)}</h3>
      <p class="ad"><i class="fa-solid fa-location-dot"></i>${esc(b.address)}</p>
      ${ph.length ? `<div class="phs">${ph.map(x => `<a href="${telHref(x)}"><i class="fa-solid fa-phone"></i>${esc(x)}</a>`).join("")}</div>` : ""}
      <div class="ac"><button class="m" type="button" data-a="map"><i class="fa-solid fa-map-location-dot"></i>${esc(t("br.map"))}</button><button class="r" type="button" data-a="report"><i class="fa-solid fa-microphone-lines"></i>${esc(t("br.report"))}</button></div>
    </div></article>`;
}

function renderBranches() {
  $("branches").hidden = !branches.length;
  $("mBranches").hidden = !branches.length;
  $("bGrid").innerHTML = branches.map(branchCard).join("");
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
    const pool = posts.length ? [...posts].sort(() => Math.random() - 0.5).slice(0, 4) : [];
    $("spChips").innerHTML = pool.map(p => cardHTML(p, "pill")).join("");
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
  const b = branches.find(x => x.id === id);
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
  $("bvPh").innerHTML = [b.phone, b.phone2, b.phone3].filter(Boolean).map(x => `<a href="${telHref(x)}"><i class="fa-solid fa-phone"></i>${esc(x)}</a>`).join("");
  $("bvDir").href = `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`;
  $("bvRep").dataset.id = b.id;
  $("bvMsg").textContent = t("bv.finding");
  $("bvSub").textContent = b.name;
  $("bvTitle").scrollIntoView({ block: "nearest" });
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
    const line = L.polyline([], { color: "#ffd166", weight: 6, opacity: 0.95, className: "route" }).addTo(map);
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

function fmtT(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

function micReset() {
  clearInterval(recT);
  if (stream) stream.getTracks().forEach(x => x.stop());
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
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find(x => window.MediaRecorder && MediaRecorder.isTypeSupported(x)) || "";
  try {
    rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 16000 });
  } catch (e) {
    stream.getTracks().forEach(x => x.stop());
    return toast("error", t("e.mic"));
  }
  chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    clearInterval(recT);
    stream.getTracks().forEach(x => x.stop());
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
    if (recS >= 60) rec.stop();
  }, 1000);
}

$("mic").onclick = () => {
  if (rec && rec.state === "recording") rec.stop();
  else if (!blob) startRec();
};
$("micR").onclick = () => { micReset(); startRec(); };

$("rpTypes").querySelectorAll(".tp").forEach(b => b.onclick = () => {
  kind = b.dataset.k;
  $("rpTypes").querySelectorAll(".tp").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
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
  const b = branches.find(x => x.id === rpBranch);
  $("rpAt").hidden = !b;
  if (b) $("rpAt").textContent = t("rp.at", { b: b.name });
  $("rpForm").hidden = false;
  $("rpOk").hidden = true;
  if (!stack.includes($("rp"))) ovOpen($("rp"));
}

$("rpBack").onclick = back;
$("rp").addEventListener("ovclose", micReset);
$("rpNew").onclick = () => { micReset(); $("rpText").value = ""; $("rpForm").hidden = false; $("rpOk").hidden = true; };

const asDataUrl = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

$("rpSend").onclick = async () => {
  if (rec && rec.state === "recording") rec.stop();
  const name = $("rpName").value.trim();
  const phone = $("rpPhone").value.trim();
  const message = $("rpText").value.trim();
  if (name.length < 2) return toast("error", t("e.name"));
  if (!/^[0-9+\s-]{7,20}$/.test(phone)) return toast("error", t("e.phone"));
  await new Promise(r => setTimeout(r, 150));
  if (!message && !blob) return toast("error", t("e.empty"));
  showLoading(t("rp.sending"));
  try {
    const body = { name, phone, kind, message, branchId: rpBranch };
    if (where) { body.lat = where.lat; body.lng = where.lng; }
    if (blob) {
      const data = await asDataUrl(blob);
      if (data.length > 440000) { hideLoading(); return toast("error", t("e.long")); }
      body.audio = data;
    }
    const res = await fetch("/api/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    if (j.ok) {
      $("rpRef").textContent = j.ref;
      $("rpForm").hidden = true;
      $("rpOk").hidden = false;
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
  ids.forEach(syncCards);
  renderDock();
};

let io = null;
function observeReveal() {
  if (!io) io = new IntersectionObserver(en => en.forEach(x => { if (x.isIntersecting) { x.target.classList.add("in"); io.unobserve(x.target); } }), { rootMargin: "0px 0px -8% 0px" });
  document.querySelectorAll(".rv:not(.in)").forEach(el => io.observe(el));
}

new IntersectionObserver(en => en.forEach(x => x.target.classList.toggle("vis", x.isIntersecting)), { rootMargin: "120px" }).observe($("mq"));
$("mq").addEventListener("pointerdown", () => $("mq").classList.add("touch"));
let mqT = 0;
["pointerup", "pointercancel"].forEach(ev => $("mq").addEventListener(ev, () => { clearTimeout(mqT); mqT = setTimeout(() => $("mq").classList.remove("touch"), 4000); }));

async function loadPosts() {
  const snap = await get(query(ref(db, "posts"), orderByChild("createdAt"), limitToLast(LIMIT)));
  const rows = [];
  snap.forEach(c => { rows.push({ id: c.key, ...c.val() }); });
  rows.sort((a, b) => b.createdAt - a.createdAt);
  posts = rows;
  const last = rows[rows.length - 1];
  older = { key: last ? last.id : null, time: last ? last.createdAt : null, more: rows.length >= LIMIT };
  rows.forEach(p => { if (cart[p.id]) Object.assign(cart[p.id], { n: p.name, p: p.price, u: p.unit, i: p.image }); });
  saveCart();
}

async function loadMore() {
  if (busyMore || !older.more) return;
  busyMore = true;
  try {
    const snap = await get(query(ref(db, "posts"), orderByChild("createdAt"), endBefore(older.time, older.key), limitToLast(MORE)));
    const rows = [];
    snap.forEach(c => { rows.push({ id: c.key, ...c.val() }); });
    rows.sort((a, b) => b.createdAt - a.createdAt);
    if (rows.length) { older.key = rows[rows.length - 1].id; older.time = rows[rows.length - 1].createdAt; }
    older.more = rows.length >= MORE;
    posts = posts.concat(rows);
    rows.forEach(p => {
      if (p.category === "Water") $("wGrid").insertAdjacentHTML("beforeend", cardHTML(p, "bubble"));
      else $("mGrid").insertAdjacentHTML("beforeend", cardHTML(p, "bento"));
    });
    $("all").hidden = !$("mGrid").children.length;
    $("moreBtn").hidden = !older.more;
  } catch (e) {
    toast("error", t("err.net"));
  } finally {
    busyMore = false;
  }
}
$("moreBtn").onclick = loadMore;
new IntersectionObserver(en => { if (en[0].isIntersecting) loadMore(); }, { rootMargin: "400px" }).observe($("moreBtn"));

async function loadBranches() {
  const snap = await get(query(ref(db, "branches"), orderByChild("createdAt"), limitToLast(40)));
  const rows = [];
  snap.forEach(c => { rows.push({ id: c.key, ...c.val() }); });
  branches = rows.sort((a, b) => b.createdAt - a.createdAt).filter(b => typeof b.lat === "number" && typeof b.lng === "number");
}

async function loadPhones() {
  const snap = await get(ref(db, "settings/phones"));
  const rows = [];
  snap.forEach(c => { rows.push(c.val()); });
  phones = rows.filter(p => p && p.number);
  $("ftPhones").innerHTML = phones.map(p => `<a href="${telHref(p.number)}"><i class="fa-solid fa-phone"></i>${esc(p.label)}: ${esc(p.number)}</a>`).join("");
}

function renderAll() {
  renderBranches();
  renderPosts();
  renderDock();
  observeReveal();
}

window.addEventListener("langchange", renderAll);

setDevice();
let rz = 0;
addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(setDevice, 150); });
addEventListener("scroll", () => $("hd").classList.toggle("solid", scrollY > 30), { passive: true });
$("yr").textContent = new Date().getFullYear();

loadCart();
initLang();
autoScroll($("ps"));
renderDock();
showLoading(t("loading"));
const all = Promise.allSettled([loadBranches(), loadPosts(), loadPhones()]);
await Promise.race([all, new Promise(r => setTimeout(r, 3500))]);
hideLoading();
renderAll();
all.then(res => {
  renderAll();
  if (res.every(r => r.status === "rejected")) toast("error", t("err.net"));
});