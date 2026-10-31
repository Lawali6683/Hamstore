const IMGUR_CLIENT_ID = "5acf7eff9c91660";
const MAX_SIDE = 1100;
const TARGET_BYTES = 260 * 1024;
const ATTEMPT_MS = 30000;

if (typeof document !== "undefined" && !document.querySelector("link[data-imgur]")) {
  const l = document.createElement("link");
  l.rel = "preconnect";
  l.href = "https://api.imgur.com";
  l.crossOrigin = "anonymous";
  l.dataset.imgur = "1";
  document.head.appendChild(l);
}

const wait = ms => new Promise(r => setTimeout(r, ms));

function readDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(new Error("read"));
    r.readAsDataURL(blob);
  });
}

function toBlob(cv, type, q) {
  return new Promise(res => cv.toBlob(b => res(b), type, q));
}

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    const tries = [{ imageOrientation: "from-image" }, undefined];
    for (const opt of tries) {
      try {
        const bmp = await (opt ? createImageBitmap(file, opt) : createImageBitmap(file));
        return { src: bmp, w: bmp.width, h: bmp.height, close: () => { if (bmp.close) bmp.close(); } };
      } catch (e) {}
    }
  }
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => res({ src: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) });
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("bad image")); };
    img.src = url;
  });
}

export async function compress(file, max = MAX_SIDE, quality = 0.8) {
  if (!file) throw new Error("bad image");
  const d = await decode(file);
  try {
    let scale = Math.min(1, max / Math.max(d.w, d.h));
    const keep = (file.type === "image/jpeg" || file.type === "image/webp") && file.size <= TARGET_BYTES && scale === 1;
    let blob = file;
    if (!keep) {
      let q = quality;
      for (let i = 0; i < 5; i++) {
        const w = Math.max(1, Math.round(d.w * scale));
        const h = Math.max(1, Math.round(d.h * scale));
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        const c = cv.getContext("2d", { alpha: false });
        c.fillStyle = "#fff";
        c.fillRect(0, 0, w, h);
        c.imageSmoothingQuality = "high";
        c.drawImage(d.src, 0, 0, w, h);
        blob = await toBlob(cv, "image/jpeg", q);
        cv.width = 0;
        cv.height = 0;
        if (!blob) throw new Error("bad image");
        if (blob.size <= TARGET_BYTES) break;
        if (q > 0.55) q -= 0.12;
        else scale *= 0.82;
      }
    }
    const dataUrl = await readDataUrl(blob);
    return { blob, dataUrl, base64: dataUrl.split(",")[1] || "", size: blob.size };
  } finally {
    d.close();
  }
}

function fromBase64(b64) {
  const bin = atob(String(b64).replace(/^data:[^,]*,/, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}

async function attempt(blob, signal) {
  const fd = new FormData();
  fd.append("image", blob, "photo.jpg");
  fd.append("type", "file");
  const res = await fetch("https://api.imgur.com/3/image", {
    method: "POST",
    headers: { Authorization: "Client-ID " + IMGUR_CLIENT_ID },
    body: fd,
    signal,
    cache: "no-store",
    referrerPolicy: "no-referrer"
  });
  let json = null;
  try { json = await res.json(); } catch (e) {}
  if (json && json.success && json.data && json.data.link) return String(json.data.link).replace(/^http:/, "https:");
  const err = new Error("upload");
  err.status = res.status;
  throw err;
}

export async function uploadToImgur(input, opts = {}) {
  const blob = typeof input === "string" ? fromBase64(input) : input;
  if (!blob) throw new Error("upload");
  const tries = opts.tries || 2;
  let last = null;
  for (let i = 0; i < tries; i++) {
    if (opts.signal && opts.signal.aborted) throw new DOMException("aborted", "AbortError");
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), ATTEMPT_MS);
    const onAbort = () => ctl.abort();
    if (opts.signal) opts.signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await attempt(blob, ctl.signal);
    } catch (e) {
      last = e;
      if (opts.signal && opts.signal.aborted) throw e;
      if (e && e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 408) break;
      await wait(600 * (i + 1));
    } finally {
      clearTimeout(tm);
      if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    }
  }
  throw last || new Error("upload");
}

export function startUpload(input) {
  const ctl = new AbortController();
  const promise = uploadToImgur(input, { signal: ctl.signal });
  return { promise, cancel: () => ctl.abort() };
}
