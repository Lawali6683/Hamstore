import { toast, compress, uploadToImgur, esc } from "./allui.js";

export const ACCESS_CODE = "668360";

export function bindCode(wrap, onOk) {
  const inputs = [...wrap.querySelectorAll("input")];
  const check = () => {
    const value = inputs.map(i => i.value).join("");
    if (value.length < inputs.length) return;
    if (value === ACCESS_CODE) return onOk();
    wrap.classList.add("bad");
    toast("error", "Wrong code", "Please try again.");
    setTimeout(() => {
      wrap.classList.remove("bad");
      inputs.forEach(i => (i.value = ""));
      inputs[0].focus();
    }, 450);
  };
  inputs.forEach((input, i) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(-1);
      if (input.value && inputs[i + 1]) inputs[i + 1].focus();
      check();
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Backspace" && !input.value && inputs[i - 1]) inputs[i - 1].focus();
    });
    input.addEventListener("paste", e => {
      const digits = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, inputs.length);
      if (!digits) return;
      e.preventDefault();
      digits.split("").forEach((d, k) => (inputs[k].value = d));
      inputs[Math.min(digits.length, inputs.length - 1)].focus();
      check();
    });
  });
  inputs[0].focus();
}

export function makeCode() {
  const yy = String(new Date().getFullYear()).slice(-2);
  const n = (crypto.getRandomValues(new Uint32Array(1))[0] % 90000) + 10000;
  return `Ham/${yy}/${n}`;
}

export const codeKey = c => String(c).trim().toLowerCase().replace(/[\/\s]+/g, "-");

export function prettyCode(key) {
  const [, yy, n] = String(key).split("-");
  return `Ham/${yy}/${n}`;
}

export const randomKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");

export const plateKey = p => String(p).toUpperCase().replace(/[^A-Z0-9]/g, "");

export const confirmLink = (code, key) => `${location.origin}/confirm.html?c=${encodeURIComponent(codeKey(code))}&k=${key}`;

export const DEFAULT_MESSAGE = "Hello {driver}, your vehicle {vehicle} ({plate}) is registered with Hamstore.\nYour ID: {code}\nOpen this link on your phone to confirm and start tracking:\n{link}";

export function messageText(v, template) {
  let t = template;
  try { t = template || localStorage.getItem("hs_msg") || DEFAULT_MESSAGE; } catch (e) { t = template || DEFAULT_MESSAGE; }
  return t.replace(/\{driver\}/g, v.driverName || "driver").replace(/\{vehicle\}/g, v.name).replace(/\{plate\}/g, v.plate).replace(/\{code\}/g, v.code).replace(/\{link\}/g, v.link);
}

export function smsHref(phone, text) {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  return `sms:${String(phone).replace(/[^\d+]/g, "")}${ios ? "&" : "?"}body=${encodeURIComponent(text)}`;
}

export const mailHref = (email, subject, text) => `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;

export async function emailDriver(idToken, v) {
  const res = await fetch("/api/gmail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, to: v.email, name: v.driverName, vehicle: v.name, plate: v.plate, code: v.code, link: v.link })
  });
  return res.json();
}

export const fmtDur = ms => {
  const m = Math.round(ms / 60000);
  if (m < 1) return "under 1 min";
  if (m < 60) return m + " min";
  return Math.floor(m / 60) + " h " + (m % 60) + " min";
};

export function bearing(a, b) {
  const r = x => (x * Math.PI) / 180;
  const y = Math.sin(r(b.lng - a.lng)) * Math.cos(r(b.lat));
  const x = Math.cos(r(a.lat)) * Math.sin(r(b.lat)) - Math.sin(r(a.lat)) * Math.cos(r(b.lat)) * Math.cos(r(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const GUIDES = {
  face: { facing: "user", shape: "circle", ratio: 1, hint: "Center your face in the circle" },
  plate: { facing: "environment", shape: "rect", ratio: 2.4, hint: "Fit the plate number in the box" },
  vehicle: { facing: "environment", shape: "rect", ratio: 1.5, hint: "Show the whole vehicle" },
  id: { facing: "environment", shape: "rect", ratio: 1.58, hint: "Place the ID card inside the box" }
};

function pickFile(kind) {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = GUIDES[kind].facing;
    input.onchange = async () => {
      if (!input.files[0]) return resolve(null);
      try { resolve(await compress(input.files[0])); } catch (e) { toast("error", "Image problem", "Choose a valid photo."); resolve(null); }
    };
    input.click();
  });
}

export function openCamera({ kind, title }) {
  const g = GUIDES[kind];
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return pickFile(kind);

  return new Promise(resolve => {
    let stream = null;
    let facing = g.facing;
    let timer = 0;
    let prev = null;
    let okCount = 0;
    let waited = 0;
    let shot = null;

    const root = document.createElement("div");
    root.className = "cam";
    root.innerHTML = `<div class="cam-top"><button class="cam-btn" type="button" data-x aria-label="Close"><i class="fa-solid fa-xmark"></i></button><b></b><button class="cam-btn" type="button" data-flip aria-label="Switch camera"><i class="fa-solid fa-camera-rotate"></i></button></div>
      <div class="cam-stage"><video playsinline muted autoplay></video><div class="cam-guide ${g.shape}" style="${g.shape === "rect" ? `aspect-ratio:${g.ratio}` : ""}"></div><div class="cam-badge">Starting camera...</div></div>
      <div class="cam-bottom"><button class="shutter" type="button" disabled aria-label="Take photo"></button></div>`;
    root.querySelector("b").textContent = title;
    document.body.appendChild(root);

    const video = root.querySelector("video");
    const stage = root.querySelector(".cam-stage");
    const guide = root.querySelector(".cam-guide");
    const badge = root.querySelector(".cam-badge");
    const shutter = root.querySelector(".shutter");
    const bottom = root.querySelector(".cam-bottom");
    const probe = document.createElement("canvas");
    probe.width = 96;
    probe.height = 72;
    const pctx = probe.getContext("2d", { willReadFrequently: true });

    const stop = () => {
      clearInterval(timer);
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
    const done = result => {
      stop();
      document.removeEventListener("keydown", onKey);
      root.remove();
      resolve(result);
    };
    const onKey = e => { if (e.key === "Escape") done(null); };
    document.addEventListener("keydown", onKey);

    const setReady = (ok, msg) => {
      root.classList.toggle("ready", ok);
      badge.innerHTML = ok ? '<i class="fa-solid fa-circle-check"></i> Looks good' : "";
      if (!ok) badge.textContent = msg;
    };

    const check = () => {
      if (!video.videoWidth) return;
      pctx.drawImage(video, 0, 0, 96, 72);
      const d = pctx.getImageData(0, 0, 96, 72).data;
      const lum = new Uint8Array(96 * 72);
      let sum = 0;
      for (let i = 0, j = 0; i < d.length; i += 4, j++) {
        lum[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
        sum += lum[j];
      }
      const avg = sum / lum.length;
      let edge = 0;
      for (let j = 1; j < lum.length; j++) edge += Math.abs(lum[j] - lum[j - 1]);
      edge /= lum.length;
      let motion = 0;
      if (prev) {
        for (let j = 0; j < lum.length; j += 3) motion += Math.abs(lum[j] - prev[j]);
        motion /= lum.length / 3;
      }
      prev = lum;
      let msg = "";
      if (avg < 45) msg = "Too dark, find more light";
      else if (avg > 225) msg = "Too bright, avoid strong glare";
      else if (motion > 14) msg = "Hold steady";
      else if (edge < 2.4) msg = "Not clear, move closer or wait";
      okCount = msg ? 0 : okCount + 1;
      waited += 400;
      const ready = okCount >= 2;
      setReady(ready, msg || g.hint);
      shutter.disabled = !(ready || waited > 6000);
    };

    async function start() {
      stop();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
        video.srcObject = stream;
        video.classList.toggle("mirror", facing === "user");
        await video.play().catch(() => {});
        badge.textContent = g.hint;
        okCount = 0;
        waited = 0;
        timer = setInterval(check, 400);
      } catch (e) {
        done(null);
        toast("error", "Camera blocked", "Allow camera access, then try again.");
      }
    }

    root.querySelector("[data-x]").onclick = () => done(null);
    root.querySelector("[data-flip]").onclick = () => { facing = facing === "user" ? "environment" : "user"; start(); };

    shutter.onclick = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const sr = stage.getBoundingClientRect();
      const gr = guide.getBoundingClientRect();
      const s = Math.max(sr.width / vw, sr.height / vh);
      const offX = (vw * s - sr.width) / 2;
      const offY = (vh * s - sr.height) / 2;
      const sx = Math.max(0, (gr.left - sr.left + offX) / s);
      const sy = Math.max(0, (gr.top - sr.top + offY) / s);
      const sw = Math.min(vw - sx, gr.width / s);
      const sh = Math.min(vh - sy, gr.height / s);
      const scale = Math.min(1, 1000 / Math.max(sw, sh));
      const c = document.createElement("canvas");
      c.width = Math.round(sw * scale);
      c.height = Math.round(sh * scale);
      c.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL("image/jpeg", 0.82);
      shot = { dataUrl, base64: dataUrl.split(",")[1] };
      clearInterval(timer);
      video.pause();
      root.classList.remove("ready");
      root.classList.add("review");
      const img = document.createElement("img");
      img.className = "shot";
      img.src = dataUrl;
      stage.appendChild(img);
      badge.textContent = "Is the photo clear?";
      bottom.innerHTML = '<button class="ghost" type="button" data-retake><i class="fa-solid fa-rotate-left"></i>Retake</button><button class="btn" type="button" data-use><i class="fa-solid fa-check"></i>Use photo</button>';
      bottom.querySelector("[data-use]").onclick = () => done(shot);
      bottom.querySelector("[data-retake]").onclick = () => {
        img.remove();
        root.classList.remove("review");
        bottom.innerHTML = "";
        bottom.appendChild(shutter);
        shutter.disabled = true;
        video.play();
        okCount = 0;
        waited = 0;
        timer = setInterval(check, 400);
      };
    };

    start();
  });
}

export function photoSlot(root, { kind, label, optional = false }) {
  let photo = null;
  root.innerHTML = `<div class="pslot ${kind}"><button type="button" class="pcam" aria-label="Take photo"><i class="fa-solid fa-camera"></i><img alt="" hidden><span class="ptick"><i class="fa-solid fa-check"></i></span></button><div class="pinfo"><b></b><small>${optional ? "Optional" : "Required"}</small></div><button type="button" class="pclear" aria-label="Remove photo" hidden><i class="fa-solid fa-xmark"></i></button></div>`;
  root.querySelector("b").textContent = label;
  const slot = root.querySelector(".pslot");
  const img = root.querySelector("img");
  const clearBtn = root.querySelector(".pclear");
  const paint = () => {
    slot.classList.toggle("done", !!photo);
    img.hidden = !photo;
    img.src = photo ? photo.dataUrl : "";
    clearBtn.hidden = !photo;
  };
  root.querySelector(".pcam").onclick = async () => {
    const got = await openCamera({ kind, title: label });
    if (got) { photo = got; paint(); }
  };
  clearBtn.onclick = () => { photo = null; paint(); };
  return {
    has: () => !!photo,
    clear() { photo = null; paint(); },
    async upload() { return photo ? uploadToImgur(photo.base64) : ""; }
  };
}

const DB_NAME = "hamstore-history";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("no idb"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore("pts", { keyPath: ["vid", "ts"] });
      store.createIndex("vid", "vid");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePoint(p) {
  try {
    const db = await openDb();
    db.transaction("pts", "readwrite").objectStore("pts").put(p);
  } catch (e) {}
}

export async function loadPoints(vid) {
  try {
    const db = await openDb();
    return await new Promise(resolve => {
      const req = db.transaction("pts").objectStore("pts").index("vid").getAll(IDBKeyRange.only(vid));
      req.onsuccess = () => resolve(req.result.sort((a, b) => a.ts - b.ts));
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

export async function prunePoints(days = 45) {
  try {
    const db = await openDb();
    const cut = Date.now() - days * 86400000;
    const store = db.transaction("pts", "readwrite").objectStore("pts");
    store.openCursor().onsuccess = e => {
      const cur = e.target.result;
      if (!cur) return;
      if (cur.value.ts < cut) cur.delete();
      cur.continue();
    };
  } catch (e) {}
}

export function liveMarker(L, map, latlng, onClick) {
  const icon = L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: '<div class="vm offline"><span class="ring"></span><span class="dir"><span class="arrow"></span></span><span class="core"></span></div>'
  });
  const marker = L.marker(latlng, { icon, zIndexOffset: 500 }).addTo(map);
  if (onClick) marker.on("click", onClick);
  let cur = [latlng[0], latlng[1]];
  let raf = 0;
  return {
    marker,
    setState(state, speed = 0, heading = null) {
      const el = marker.getElement() && marker.getElement().querySelector(".vm");
      if (!el) return;
      el.className = "vm " + state;
      el.style.setProperty("--pd", Math.max(0.6, 2.4 - speed / 50) + "s");
      if (typeof heading === "number") el.querySelector(".dir").style.transform = `rotate(${heading}deg)`;
    },
    moveTo(lat, lng, ms = 900) {
      cancelAnimationFrame(raf);
      const from = cur.slice();
      const t0 = performance.now();
      const step = t => {
        const k = Math.min(1, (t - t0) / ms);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        cur = [from[0] + (lat - from[0]) * e, from[1] + (lng - from[1]) * e];
        marker.setLatLng(cur);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    },
    remove() { cancelAnimationFrame(raf); map.removeLayer(marker); }
  };
}

export { esc };