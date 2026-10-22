import { app } from "./firebase.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";
import { showLoading, hideLoading } from "./loading.js";
import { t, initLang, esc, naira, telHref, thumb, toast, compress, uploadToImgur, setDevice, PHONE_MAIN } from "./pub.js";

const db = getDatabase(app);
const $ = id => document.getElementById(id);

let items = [];
let accounts = [];
let shot = null;
let order = null;
let closed = false;

function wanted() {
  const out = new Map();
  const add = (id, q) => {
    const qty = Math.floor(Number(q));
    if (/^POST\d{4,}$/.test(id) && qty >= 1 && qty <= 999) out.set(id, qty);
  };
  const param = new URLSearchParams(location.search).get("items");
  if (param) param.split(",").slice(0, 40).forEach(x => { const [id, q] = x.split(":"); add(id, q); });
  else {
    try {
      const raw = JSON.parse(localStorage.getItem("hs_cart") || "{}") || {};
      Object.keys(raw).slice(0, 40).forEach(id => add(id, raw[id] && raw[id].q));
    } catch (e) {}
  }
  return out;
}

const unitLabel = u => (u === "Single" ? t("cart.single") : t("cart.carton"));

function removeFromCart(id) {
  try {
    const raw = JSON.parse(localStorage.getItem("hs_cart") || "{}") || {};
    delete raw[id];
    localStorage.setItem("hs_cart", JSON.stringify(raw));
  } catch (e) {}
}

function renderItems() {
  const has = items.length > 0 && !closed;
  $("itemsBox").hidden = !has;
  $("payBox").hidden = !has;
  $("formBox").hidden = !has;
  $("emptyBox").hidden = has || !!order || closed;
  $("closedBox").hidden = !closed || !!order;
  let total = 0;
  $("ol").innerHTML = items.map(i => {
    const line = i.price * i.qty;
    total += line;
    return `<div class="or"><img src="${esc(thumb(i.image, "t"))}" alt="${esc(i.name)}"><div><b>${esc(i.name)}</b><small>${esc(unitLabel(i.unit))} · ${esc(t("cart.line", { p: naira(i.price), q: i.qty, s: naira(line) }))}</small><br><button class="rm" type="button" data-rm="${esc(i.id)}">${esc(t("buy.remove"))}</button></div><div class="ln">${naira(line)}</div></div>`;
  }).join("");
  $("tot").textContent = naira(total);
}

function renderAccs() {
  $("accs").innerHTML = accounts.length
    ? accounts.map((a, k) => `<div class="acc"><div class="bn">${esc(a.bank)} · ${esc(a.name)}</div><div class="no">${esc(a.number)}</div><button type="button" data-copy="${k}"><i class="fa-regular fa-copy"></i> ${esc(t("buy.copy"))}</button></div>`).join("")
    : `<div class="acc"><div class="bn">${esc(t("buy.noacc"))}</div><a class="bt" href="${telHref(PHONE_MAIN)}" style="justify-self:start"><i class="fa-solid fa-phone"></i>${PHONE_MAIN}</a></div>`;
}

$("ol").addEventListener("click", e => {
  const id = e.target.closest("[data-rm]")?.dataset.rm;
  if (!id) return;
  items = items.filter(i => i.id !== id);
  removeFromCart(id);
  renderItems();
});

$("accs").addEventListener("click", async e => {
  const k = e.target.closest("[data-copy]")?.dataset.copy;
  if (k === undefined) return;
  try { await navigator.clipboard.writeText(accounts[k].number); toast("ok", t("buy.copied")); } catch (err) {}
});

$("bFile").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    shot = await compress(f);
    $("bPrev").src = shot.dataUrl;
    $("bPrev").hidden = false;
  } catch (err) {
    toast("error", t("buy.e.shot"));
  }
});

function pdfText(s) {
  return String(s).replace(/₦/g, "NGN ").replace(/[^\x20-\x7e]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function makePdf(lines) {
  const pages = [];
  let cur = [];
  let y = 800;
  lines.forEach(l => {
    if (y < 60) { pages.push(cur); cur = []; y = 800; }
    cur.push(`BT /${l.b ? "F2" : "F1"} ${l.s} Tf 50 ${y} Td (${pdfText(l.t)}) Tj ET`);
    y -= l.s + 8;
  });
  pages.push(cur);
  const objs = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  pages.forEach((p, i) => {
    const stream = p.join("\n");
    objs[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${6 + i * 2} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`;
    objs[6 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const off = [];
  for (let i = 1; i < objs.length; i++) {
    off[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += String(off[i]).padStart(10, "0") + " 00000 n \n";
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out], { type: "application/pdf" });
}

function downloadPdf() {
  const o = order;
  const when = new Date(o.createdAt).toLocaleString("en-GB");
  const lines = [
    { t: "HAMSTORE INTEGRATED SERVICES", s: 18, b: true },
    { t: "Order receipt", s: 12 },
    { t: "", s: 6 },
    { t: "Code: " + o.code, s: 16, b: true },
    { t: "Date: " + when, s: 11 },
    { t: "Name: " + o.name, s: 11 },
    { t: "Phone: " + o.phone, s: 11 },
    { t: "Address: " + o.address, s: 11 },
    { t: "", s: 8 },
    { t: "Items", s: 13, b: true },
    ...o.items.map(i => ({ t: `${i.name} (${i.unit}) ${i.qty} x NGN ${i.price.toLocaleString("en-US")} = NGN ${i.line.toLocaleString("en-US")}`, s: 11 })),
    { t: "", s: 8 },
    { t: "TOTAL: NGN " + o.total.toLocaleString("en-US"), s: 16, b: true },
    { t: "", s: 8 },
    { t: "Keep this code until your goods arrive.", s: 11 },
    { t: "Call us: " + PHONE_MAIN, s: 11 }
  ];
  const url = URL.createObjectURL(makePdf(lines));
  const a = document.createElement("a");
  a.href = url;
  a.download = "hamstore-" + o.code.replace(/\//g, "-") + ".pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("bName").value.trim();
  const phone = $("bPhone").value.trim();
  const address = $("bAddr").value.trim();
  if (name.length < 2) return toast("error", t("buy.e.name"));
  if (!/^[0-9+\s-]{7,20}$/.test(phone)) return toast("error", t("buy.e.phone"));
  if (address.length < 5) return toast("error", t("buy.e.addr"));
  if (!shot) return toast("error", t("buy.e.shot"));
  if (!items.length) return;

  showLoading(t("buy.upl"));
  try {
    const link = await uploadToImgur(shot.base64);
    hideLoading();
    showLoading(t("buy.sending"));
    const res = await fetch("/api/pay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, address, shot: link, items: items.map(i => ({ id: i.id, qty: i.qty })) })
    });
    const j = await res.json();
    if (!j.ok) {
      const msg = j.code === "closed" ? t("e.closed") : j.code === "gone" ? t("buy.e.gone") : j.code === "wait" ? t("e.wait") : j.code === "phone" ? t("buy.e.phone") : t("e.server");
      return toast("error", msg);
    }
    order = { code: j.code, total: j.total, items: j.items, createdAt: j.createdAt, name, phone, address };
    try { localStorage.removeItem("hs_cart"); } catch (err) {}
    items = [];
    ["itemsBox", "payBox", "formBox", "emptyBox"].forEach(id => { $(id).hidden = true; });
    $("dCode").textContent = j.code;
    $("done").hidden = false;
    scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    toast("error", err.message === "upload" ? t("buy.e.shot") : t("err.net"));
  } finally {
    hideLoading();
  }
});

$("dCopy").onclick = async () => {
  try { await navigator.clipboard.writeText(order.code); toast("ok", t("buy.copied")); } catch (e) {}
};
$("dPdf").onclick = () => { if (order) downloadPdf(); };

window.addEventListener("langchange", () => { renderItems(); renderAccs(); });

setDevice();
initLang();
showLoading(t("loading"));
try {
  const want = wanted();
  const rows = await Promise.all([...want.keys()].map(id => get(ref(db, "posts/" + id)).then(s => ({ id, v: s.val() })).catch(() => ({ id, v: null }))));
  items = rows.filter(r => r.v && typeof r.v.price === "number").map(r => ({ id: r.id, name: r.v.name, unit: r.v.unit, price: r.v.price, image: r.v.image, qty: want.get(r.id) }));
  const snap = await get(ref(db, "settings/payment")).catch(() => null);
  accounts = [];
  if (snap) snap.forEach(c => { const v = c.val(); if (v && v.number) accounts.push(v); });
  closed = (await get(ref(db, "settings/shop/open")).then(s => s.val()).catch(() => null)) === "no";
} catch (e) {
  toast("error", t("err.net"));
}
hideLoading();
renderItems();
renderAccs();
