const LOGO = "https://i.imgur.com/UXH5q5w.png";
const IMGUR_CLIENT_ID = "5acf7eff9c91660";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const naira = n => "₦" + Number(n || 0).toLocaleString("en-NG");

export const telHref = n => "tel:" + String(n || "").replace(/[^\d+]/g, "");

export function ago(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + " min ago";
  if (s < 86400) return Math.floor(s / 3600) + " h ago";
  return new Date(ts).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

export function toast(type, title, text = "", ms = 4500) {
  const box = document.getElementById("hsToasts");
  if (!box) return;
  const t = document.createElement("div");
  t.className = "toast " + (type === "error" ? "error" : "");
  t.setAttribute("role", type === "error" ? "alert" : "status");
  t.innerHTML = `<i class="fa-solid ${type === "error" ? "fa-circle-exclamation" : "fa-circle-check"}"></i><div><b></b><span></span></div>`;
  t.querySelector("b").textContent = title;
  t.querySelector("span").textContent = text;
  box.appendChild(t);
  const close = () => { t.classList.add("out"); setTimeout(() => t.remove(), 300); };
  t.addEventListener("click", close);
  setTimeout(close, ms);
}

export function openModal(node) {
  const wrap = document.createElement("div");
  wrap.className = "modal";
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  sheet.appendChild(node);
  wrap.appendChild(sheet);
  document.body.appendChild(wrap);
  const onKey = e => { if (e.key === "Escape") close(); };
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
  document.addEventListener("keydown", onKey);
  wrap.addEventListener("click", e => { if (e.target === wrap) close(); });
  return close;
}

export function confirmBox({ title, text, okText = "Yes, continue", danger = false }) {
  return new Promise(resolve => {
    const box = document.createElement("div");
    box.innerHTML = `<h3></h3><p></p><div class="row"><button class="ghost" type="button">Cancel</button><button class="btn ${danger ? "red" : ""}" type="button"></button></div>`;
    box.querySelector("h3").textContent = title;
    box.querySelector("p").textContent = text;
    const [no, yes] = box.querySelectorAll("button");
    yes.textContent = okText;
    const close = openModal(box);
    no.onclick = () => { close(); resolve(false); };
    yes.onclick = () => { close(); resolve(true); };
  });
}

const PAGES = [
  ["home", "admin.html", "fa-house", "Home"],
  ["post", "adminpost.html", "fa-boxes-stacked", "Posts"],
  ["branch", "adminbranch.html", "fa-store", "Branches"],
  ["rep", "adminrep.html", "fa-inbox", "Requests"],
  ["map", "adminmap.html", "fa-map-location-dot", "Fleet map"],
  ["veh", "adminveh.html", "fa-id-card", "Register vehicle"],
  ["send", "adminsend.html", "fa-paper-plane", "Vehicles and messages"],
  ["pay", "adminpay.html", "fa-money-check-dollar", "Payments"],
  ["shop", "adminshop.html", "fa-toggle-on", "Online buying"]
];

export function adminHeader(active) {
  const links = PAGES.map(([k, href, icon, label]) =>
    `<a class="ibtn ${k === active ? "on" : ""}" href="${href}" title="${label}" aria-label="${label}"><i class="fa-solid ${icon}"></i></a>`).join("");
  document.body.insertAdjacentHTML("afterbegin",
    `<header class="bar"><button class="ibtn" id="hsBack" type="button" aria-label="Go back"><i class="fa-solid fa-arrow-left"></i></button><a class="brand" href="index.html"><img class="logo" src="${LOGO}" alt="Hamstore"></a><nav class="nav">${links}</nav><span class="sp"></span><button class="ibtn" id="hsOut" type="button" aria-label="Log out" title="Log out"><i class="fa-solid fa-right-from-bracket"></i></button></header>`);
  document.getElementById("hsBack").onclick = () => (history.length > 1 ? history.back() : location.assign("index.html"));
}

export const imageFieldHTML = () => `
<span class="lab">Image</span>
<label class="drop"><i class="fa-solid fa-cloud-arrow-up"></i><span>Tap to upload from your device</span><input data-f type="file" accept="image/*" hidden></label>
<div class="field"><i class="fa-solid fa-link lead"></i><input data-u type="url" placeholder="Or paste an image link"></div>
<div class="prev" data-pv><img alt="Preview"><button type="button" class="x" data-x aria-label="Remove image"><i class="fa-solid fa-xmark"></i></button></div>`;

export function compress(file, max = 1100, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL("image/jpeg", quality);
      resolve({ dataUrl, base64: dataUrl.split(",")[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

export async function uploadToImgur(base64) {
  const res = await fetch("https://api.imgur.com/3/image", {
    method: "POST",
    headers: { Authorization: "Client-ID " + IMGUR_CLIENT_ID },
    body: new URLSearchParams({ image: base64, type: "base64" })
  });
  const json = await res.json();
  if (!json.success) throw new Error("upload");
  return json.data.link;
}

export function imagePicker(root) {
  const file = root.querySelector("[data-f]");
  const url = root.querySelector("[data-u]");
  const box = root.querySelector("[data-pv]");
  const img = box.querySelector("img");
  let picked = null;
  const show = src => { img.src = src || ""; box.classList.toggle("on", !!src); };
  const clear = () => { picked = null; file.value = ""; url.value = ""; show(""); };
  file.onchange = async () => {
    if (!file.files[0]) return;
    try {
      picked = await compress(file.files[0]);
      url.value = "";
      show(picked.dataUrl);
    } catch (e) {
      toast("error", "Image problem", "Choose a valid photo.");
    }
  };
  url.onchange = () => {
    const v = url.value.trim();
    if (!v) return show(picked ? picked.dataUrl : "");
    picked = null;
    file.value = "";
    show(v);
  };
  img.onerror = () => { if (img.getAttribute("src")) toast("error", "Image not loading", "Check the link and try again."); };
  box.querySelector("[data-x]").onclick = clear;
  return {
    clear,
    set(src) { picked = null; file.value = ""; url.value = src || ""; show(src || ""); },
    has: () => !!(picked || url.value.trim()),
    uploads: () => !!picked,
    resolve: () => (picked ? uploadToImgur(picked.base64) : Promise.resolve(url.value.trim()))
  };
}

let mapPromise = null;

export function loadMap() {
  if (mapPromise) return mapPromise;
  mapPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
    js.onload = () => resolve(window.L);
    js.onerror = reject;
    document.head.appendChild(js);
  });
  return mapPromise;
}

export const tiles = L =>
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" });

export function dot(L, color, size = 22) {
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 3px ${color}55,0 4px 10px rgba(0,0,0,.5)"></span>`
  });
}

export async function geocode(text) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ng&q=${encodeURIComponent(text)}`);
  const list = await res.json();
  return list[0] ? { lat: Number(list[0].lat), lng: Number(list[0].lon) } : null;
}

export function km(a, b) {
  const r = x => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function nearest(point, list) {
  let best = null;
  list.forEach(b => {
    if (typeof b.lat !== "number" || typeof b.lng !== "number") return;
    const d = km(point, b);
    if (!best || d < best.d) best = { branch: b, d };
  });
  return best;
}

function initUI() {
  if (!document.getElementById("hsToasts")) {
    const box = document.createElement("div");
    box.id = "hsToasts";
    box.className = "toasts";
    box.setAttribute("aria-live", "polite");
    document.body.appendChild(box);
  }
  document.querySelectorAll("[data-eye]").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.eye);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = show ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });
  });
}

initUI();
