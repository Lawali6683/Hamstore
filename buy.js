import { supabase, must } from "./supabase.js";
import { showLoading, hideLoading } from "./loading.js";
import { t, getLang, initLang, esc, naira, telHref, thumb, toast, compress, uploadToImgur, setDevice, PHONE_MAIN } from "./pub.js";
import { downloadSlip, shareSlip, qrCanvas, driverUrl, SITE_URL } from "./slip.js";

const $ = id => document.getElementById(id);

const X = {
  en: {
    upWork: "Uploading proof...", upOk: "Proof uploaded", upFail: "Upload failed. We will try again when you send.",
    locWait: "Getting your location...", locOk: "Location saved for the driver", locNo: "Could not get your location. Type your address instead.",
    noacc: "Payment account is not ready. Please call us.", sending: "Sending your order...", slow: "This is taking long. Please try again.",
    pdf: "Preparing your slip...", copied: "Code copied", plus: "More", minus: "Less"
  },
  ha: {
    upWork: "Ana loda shaidar biya...", upOk: "An loda shaidar biya", upFail: "An kasa loda. Za mu sake gwadawa idan ka tura.",
    locWait: "Ana neman wurinka...", locOk: "An adana wurinka don direba", locNo: "Ba mu samu wurinka ba. Ka rubuta adireshinka.",
    noacc: "Asusun biyan kuɗi bai shirya ba. Ka kira mu.", sending: "Ana tura odarka...", slow: "Yana ɗaukar lokaci. Sake gwadawa.",
    pdf: "Ana shirya slip ɗinka...", copied: "An kwafi lambar", plus: "Ƙara", minus: "Rage"
  }
};
const x = k => (X[getLang()] || X.en)[k] ?? k;

let items = [];
let accounts = [];
let shot = null;
let shotLink = "";
let upP = null;
let order = null;
let closed = false;
let where = null;
let busy = false;

function wanted() {
  const out = new Map();
  const add = (id, q) => {
    const qty = Math.floor(Number(q));
    if (/^POST\d{4,}$/.test(id) && qty >= 1 && qty <= 999) out.set(id, qty);
  };
  const param = new URLSearchParams(location.search).get("items");
  if (param) param.split(",").slice(0, 40).forEach(v => { const [id, q] = v.split(":"); add(id, q); });
  else {
    try {
      const raw = JSON.parse(localStorage.getItem("hs_cart") || "{}") || {};
      Object.keys(raw).slice(0, 40).forEach(id => add(id, raw[id] && raw[id].q));
    } catch (e) {}
  }
  return out;
}

const unitLabel = u => (u === "Single" ? t("cart.single") : t("cart.carton"));

function editCart(id, q) {
  try {
    const raw = JSON.parse(localStorage.getItem("hs_cart") || "{}") || {};
    if (!raw[id]) return;
    if (q === 0) delete raw[id];
    else raw[id].q = q;
    localStorage.setItem("hs_cart", JSON.stringify(raw));
  } catch (e) {}
}

const sum = () => items.reduce((a, i) => a + i.price * i.qty, 0);
const ready = () => items.length > 0 && !closed && accounts.length > 0;

function setStep(n) {
  [...$("flow3").children].forEach((li, i) => li.classList.toggle("on", i < n));
}

function renderTotals() {
  const total = sum();
  $("tot").textContent = naira(total);
  $("payAmt").textContent = naira(total);
  items.forEach(i => {
    const el = document.querySelector(`.or[data-id="${i.id}"]`);
    if (!el) return;
    el.querySelector(".ln").textContent = naira(i.price * i.qty);
    el.querySelector(".sb").textContent = t("cart.line", { p: naira(i.price), q: i.qty, s: naira(i.price * i.qty) });
  });
}

function renderItems() {
  $("ol").innerHTML = items.map(i => `<div class="or" data-id="${esc(i.id)}"><img src="${esc(thumb(i.image, "t"))}" alt="${esc(i.name)}"><div class="mid"><b>${esc(i.name)}</b><small>${esc(unitLabel(i.unit))}</small><div class="stp"><button type="button" data-d="-1" aria-label="${esc(x("minus"))}">−</button><input type="text" inputmode="numeric" maxlength="3" value="${i.qty}" data-qi aria-label="Quantity"><button type="button" data-d="1" aria-label="${esc(x("plus"))}">+</button></div><small class="sb">${esc(t("cart.line", { p: naira(i.price), q: i.qty, s: naira(i.price * i.qty) }))}</small></div><div class="rt"><div class="ln">${naira(i.price * i.qty)}</div><button class="rm" type="button" data-rm>${esc(t("buy.remove"))}</button></div></div>`).join("");
  renderTotals();
}

function renderAccs() {
  $("accs").innerHTML = accounts.map((a, k) => `<div class="acc"><div class="bn">${esc(a.bank)} · ${esc(a.name)}</div><div class="no">${esc(a.number)}</div><button type="button" data-copy="${k}"><i class="fa-regular fa-copy"></i> ${esc(t("buy.copy"))}</button></div>`).join("");
}

function lastOrder() {
  try { return JSON.parse(localStorage.getItem("hs_last_order") || "null"); } catch (e) { return null; }
}

function layout() {
  const has = items.length > 0;
  $("closedBox").hidden = !closed || !!order;
  $("itemsBox").hidden = !has || closed || !!order;
  $("emptyBox").hidden = has || closed || !!order;
  $("noAccBox").hidden = !has || closed || accounts.length > 0 || !!order;
  $("payBox").hidden = !ready() || !!order;
  $("formBox").hidden = !ready() || !!order;
  $("bSubmit").disabled = !ready() || busy;
  $("flow3").hidden = !!order || closed || !has;
  const last = lastOrder();
  $("lastBox").hidden = !last;
  if (last) $("lastCode").textContent = last.code;
  renderAccs();
  renderTotals();
}

$("ol").addEventListener("click", e => {
  const row = e.target.closest(".or");
  if (!row) return;
  const id = row.dataset.id;
  const it = items.find(z => z.id === id);
  if (!it) return;
  if (e.target.closest("[data-rm]")) {
    items = items.filter(z => z.id !== id);
    editCart(id, 0);
    renderItems();
    layout();
    return;
  }
  const d = e.target.closest("[data-d]");
  if (d) {
    const next = it.qty + Number(d.dataset.d);
    if (next < 1) {
      items = items.filter(z => z.id !== id);
      editCart(id, 0);
      renderItems();
      layout();
      return;
    }
    it.qty = Math.min(999, next);
    editCart(id, it.qty);
    row.querySelector("[data-qi]").value = it.qty;
    renderTotals();
  }
});

$("ol").addEventListener("input", e => {
  const inp = e.target.closest("[data-qi]");
  if (!inp) return;
  inp.value = inp.value.replace(/\D/g, "").slice(0, 3);
  const v = parseInt(inp.value, 10);
  const it = items.find(z => z.id === inp.closest(".or").dataset.id);
  if (!it || !(v >= 1)) return;
  it.qty = Math.min(999, v);
  editCart(it.id, it.qty);
  renderTotals();
});

$("ol").addEventListener("focusout", e => {
  const inp = e.target.closest("[data-qi]");
  if (!inp) return;
  const it = items.find(z => z.id === inp.closest(".or").dataset.id);
  if (it && !(parseInt(inp.value, 10) >= 1)) inp.value = it.qty;
});

$("accs").addEventListener("click", async e => {
  const k = e.target.closest("[data-copy]")?.dataset.copy;
  if (k === undefined) return;
  try { await navigator.clipboard.writeText(accounts[k].number); toast("ok", t("buy.copied")); } catch (err) {}
});

function setUp(state) {
  const el = $("bUp");
  el.hidden = !state;
  el.className = "upst " + state;
  el.innerHTML = state === "work" ? `<i class="fa-solid fa-spinner fa-spin"></i> ${esc(x("upWork"))}` : state === "ok" ? `<i class="fa-solid fa-circle-check"></i> ${esc(x("upOk"))}` : state === "fail" ? `<i class="fa-solid fa-triangle-exclamation"></i> ${esc(x("upFail"))}` : "";
}

$("bFile").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  shot = null;
  shotLink = "";
  upP = null;
  setUp("work");
  try {
    shot = await compress(f);
    $("bPrev").src = shot.dataUrl;
    $("bPrev").hidden = false;
    setStep(3);
    const p = uploadToImgur(shot.base64);
    upP = p;
    p.then(link => { if (upP === p) { shotLink = link; setUp("ok"); } }).catch(() => { if (upP === p) { shotLink = ""; setUp("fail"); } });
  } catch (err) {
    setUp("");
    toast("error", t("buy.e.shot"));
  }
});

const getPos = (timeout = 10000) => new Promise((res, rej) => {
  if (!navigator.geolocation) return rej(new Error("none"));
  navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), rej, { enableHighAccuracy: true, timeout, maximumAge: 30000 });
});

async function reverse(lat, lng) {
  try {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=${getLang()}`, { signal: ctl.signal });
    clearTimeout(tm);
    const j = await r.json();
    return j.display_name || "";
  } catch (e) { return ""; }
}

$("bLoc").onclick = async () => {
  $("bLocS").textContent = x("locWait");
  try {
    where = await getPos(12000);
    $("bLocS").textContent = x("locOk");
    const a = await reverse(where.lat, where.lng);
    if (a && !$("bAddr").value.trim()) $("bAddr").value = a.slice(0, 200);
  } catch (e) {
    where = null;
    $("bLocS").textContent = x("locNo");
  }
};

function saveLast(o) {
  try { localStorage.setItem("hs_last_order", JSON.stringify(o)); } catch (e) {}
}

async function showDone() {
  $("done").hidden = false;
  $("dCode").textContent = order.code;
  const [a, b] = await Promise.all([qrCanvas(driverUrl(order.code), 240), qrCanvas(SITE_URL, 240)]);
  $("qrDriver").replaceChildren(...(a ? [a] : []));
  $("qrSite").replaceChildren(...(b ? [b] : []));
}

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  if (busy || !ready()) return;
  const name = $("bName").value.trim();
  const phone = $("bPhone").value.trim();
  const address = $("bAddr").value.trim();
  if (name.length < 2) return toast("error", t("buy.e.name"));
  if (!/^[0-9+\s-]{7,20}$/.test(phone)) return toast("error", t("buy.e.phone"));
  if (address.length < 5) return toast("error", t("buy.e.addr"));
  if (!shot) return toast("error", t("buy.e.shot"));

  busy = true;
  $("bSubmit").disabled = true;
  showLoading(x("sending"));
  try {
    let link = shotLink;
    if (!link) {
      try { link = await upP; } catch (err) { link = ""; }
      if (!link) link = await uploadToImgur(shot.base64);
    }
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), 30000);
    const res = await fetch("/api/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, address, shot: link, items: items.map(i => ({ id: i.id, qty: i.qty })) }),
      signal: ctl.signal
    });
    clearTimeout(tm);
    const j = await res.json();
    if (!j.ok) {
      const msg = j.code === "closed" ? t("e.closed") : j.code === "gone" ? t("buy.e.gone") : j.code === "wait" ? t("e.wait") : j.code === "phone" ? t("buy.e.phone") : /account/i.test(String(j.code || j.error || "")) ? x("noacc") : t("e.server");
      return toast("error", msg);
    }
    order = {
      code: j.code,
      total: Number(j.total) || sum(),
      createdAt: Number(j.createdAt) || Date.now(),
      name,
      phone,
      address,
      items: (j.items || []).map(i => ({ name: i.name, unit: i.unit, qty: Number(i.qty) || 0, price: Number(i.price) || 0, line: Number(i.line) || (Number(i.price) || 0) * (Number(i.qty) || 0) }))
    };
    saveLast(order);
    try {
      localStorage.removeItem("hs_cart");
      localStorage.setItem("hs_who", JSON.stringify({ n: name, p: phone }));
    } catch (err) {}
    items = [];
    layout();
    await showDone();
    scrollTo({ top: 0, behavior: "smooth" });
    const attach = pos => { if (pos) supabase.rpc("attach_location", { p_code: order.code, p_lat: pos.lat, p_lng: pos.lng }).then(() => {}, () => {}); };
    if (where) attach(where);
    else if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "geolocation" }).then(st => { if (st.state === "granted") getPos(6000).then(attach, () => {}); }, () => {});
    }
  } catch (err) {
    toast("error", err && err.name === "AbortError" ? x("slow") : err && err.message === "upload" ? t("buy.e.shot") : t("err.net"));
  } finally {
    busy = false;
    hideLoading();
    $("bSubmit").disabled = !ready();
  }
});

$("dCopy").onclick = async () => {
  try { await navigator.clipboard.writeText(order.code); toast("ok", x("copied")); } catch (e) {}
};
$("dPdf").onclick = async () => {
  if (!order) return;
  showLoading(x("pdf"));
  try { await downloadSlip(order); } catch (e) { toast("error", t("err.net")); } finally { hideLoading(); }
};
$("dShare").onclick = async () => {
  if (!order) return;
  showLoading(x("pdf"));
  try { await shareSlip(order); } catch (e) { toast("error", t("err.net")); } finally { hideLoading(); }
};
$("lastPdf").onclick = async () => {
  const o = lastOrder();
  if (!o) return;
  showLoading(x("pdf"));
  try { await downloadSlip(o); } catch (e) { toast("error", t("err.net")); } finally { hideLoading(); }
};

window.addEventListener("langchange", () => { if (items.length) renderItems(); layout(); if (!$("bUp").hidden) setUp($("bUp").classList.contains("ok") ? "ok" : $("bUp").classList.contains("fail") ? "fail" : "work"); });

setDevice();
initLang();
try {
  const w = JSON.parse(localStorage.getItem("hs_who") || "{}");
  if (w.n) $("bName").value = w.n;
  if (w.p) $("bPhone").value = w.p;
} catch (e) {}
$("noAccCall").href = telHref(PHONE_MAIN);

showLoading(t("loading"));
try {
  const want = wanted();
  const ids = [...want.keys()];
  const [postsRes, accRes, shopRes] = await Promise.all([
    ids.length ? supabase.from("posts").select("id,name,unit,price,image").in("id", ids) : Promise.resolve({ data: [], error: null }),
    supabase.from("payment_accounts").select("bank,name,number").order("created_at", { ascending: true }),
    supabase.from("settings").select("value").eq("key", "shop_open").maybeSingle()
  ]);
  const rows = must(postsRes) || [];
  items = rows
    .filter(r => Number.isFinite(Number(r.price)))
    .map(r => ({ id: r.id, name: r.name, unit: r.unit, price: Number(r.price), image: r.image, qty: want.get(r.id) }));
  accounts = (accRes.error ? [] : accRes.data || []).filter(v => v && String(v.number || "").trim());
  closed = !shopRes.error && !!shopRes.data && shopRes.data.value === "no";
  if (accRes.error) toast("error", t("err.net"));
} catch (e) {
  toast("error", t("err.net"));
}
hideLoading();
renderItems();
layout();
setStep(accounts.length ? 2 : 1);
