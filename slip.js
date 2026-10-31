export const SITE_URL = "https://hamstore.com.ng";
export const PHONE_NUMBER = "08060767279";
export const driverUrl = code => `${SITE_URL}/driver.html?code=${encodeURIComponent(code)}`;

const LOGO = "https://i.imgur.com/UXH5q5w.png";
const QR_LIB = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
const W = 1240;
const H = 1754;
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const MONO = "ui-monospace, Menlo, Consolas, monospace";
const SCRIPT = "Lobster, 'Segoe Script', 'Brush Script MT', cursive";
const FIRST_ROWS = 6;
const NEXT_ROWS = 15;
const ROW_H = 64;

let qrP = null;

function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (qrP) return qrP;
  qrP = new Promise(res => {
    const s = document.createElement("script");
    s.src = QR_LIB;
    s.onload = () => res(window.qrcode || null);
    s.onerror = () => { qrP = null; res(null); };
    document.head.appendChild(s);
  });
  return qrP;
}

function loadImg(src) {
  return new Promise(res => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

export async function qrCanvas(text, px) {
  const lib = await loadQr();
  if (!lib) return null;
  const qr = lib(0, "M");
  qr.addData(String(text));
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 3;
  const cell = Math.max(2, Math.floor(px / (n + quiet * 2)));
  const size = cell * (n + quiet * 2);
  const cv = document.createElement("canvas");
  cv.width = size;
  cv.height = size;
  const c = cv.getContext("2d");
  c.fillStyle = "#fff";
  c.fillRect(0, 0, size, size);
  c.fillStyle = "#10261b";
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < n; k++) {
      if (qr.isDark(r, k)) c.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
  }
  return cv;
}

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function fit(c, text, max) {
  let s = String(text);
  if (c.measureText(s).width <= max) return s;
  while (s.length > 1 && c.measureText(s + "…").width > max) s = s.slice(0, -1);
  return s.trim() + "…";
}

function wrap(c, text, max, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  words.forEach(w => {
    const t = cur ? cur + " " + w : w;
    if (c.measureText(t).width > max && cur) { lines.push(cur); cur = w; } else cur = t;
  });
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = fit(c, lines[maxLines - 1] + "…", max);
  }
  return lines;
}

const money = n => "₦" + Math.round(Number(n) || 0).toLocaleString("en-US");

function pageCount(len) {
  return len <= FIRST_ROWS ? 1 : 1 + Math.ceil((len - FIRST_ROWS) / NEXT_ROWS);
}

function paint(o, page, pages, logo, qrDriver, qrSite) {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d");
  const links = [];
  const first = page === 0;
  const last = page === pages - 1;
  const code = String(o.code);

  c.fillStyle = "#fff";
  c.fillRect(0, 0, W, H);

  if (logo) {
    c.save();
    c.globalAlpha = 0.07;
    c.translate(W / 2, H / 2);
    c.rotate(-0.3);
    const w = 980;
    const h = (logo.height / logo.width) * w;
    c.drawImage(logo, -w / 2, -h / 2, w, h);
    c.restore();
  }

  const g = c.createLinearGradient(0, 0, W, first ? 300 : 150);
  g.addColorStop(0, "#0f6b3d");
  g.addColorStop(1, "#1f9d5c");
  c.fillStyle = g;
  c.fillRect(0, 0, W, first ? 300 : 150);
  c.fillStyle = "#e03a3a";
  c.beginPath();
  c.ellipse(W - 110, first ? 40 : 10, first ? 360 : 260, first ? 200 : 110, -0.2, 0, Math.PI * 2);
  c.fill();

  if (first) {
    c.fillStyle = "#fff";
    c.beginPath();
    c.ellipse(W / 2, 330, W * 0.75, 70, 0, 0, Math.PI * 2);
    c.fill();
  }

  const lh = first ? 150 : 90;
  const ly = first ? 50 : 30;
  c.fillStyle = "#fff";
  rr(c, 60, ly, first ? 330 : 220, lh, 28);
  c.fill();
  if (logo) {
    const bw = first ? 290 : 190;
    const bh = lh - 24;
    const s = Math.min(bw / logo.width, bh / logo.height);
    c.drawImage(logo, 60 + ((first ? 330 : 220) - logo.width * s) / 2, ly + (lh - logo.height * s) / 2, logo.width * s, logo.height * s);
  } else {
    c.fillStyle = "#e03a3a";
    c.font = `46px ${SCRIPT}`;
    c.textAlign = "left";
    c.fillText("Hamstore", 90, ly + lh / 2 + 16);
  }

  c.textAlign = "left";
  c.fillStyle = "#fff";
  c.font = `800 ${first ? 64 : 44}px ${SANS}`;
  c.fillText("ORDER SLIP", first ? 430 : 310, first ? 120 : 80);
  c.font = `${first ? 44 : 32}px ${SCRIPT}`;
  c.fillText(first ? "Fresh from Hamstore" : code, first ? 430 : 310, first ? 182 : 122);
  c.font = `600 24px ${SANS}`;
  c.textAlign = "right";
  c.fillText(`${page + 1} / ${pages}`, W - 70, first ? 262 : 134);

  let tableTop = 190;

  if (first) {
    c.textAlign = "center";
    c.fillStyle = "#0f6b3d";
    c.font = `800 24px ${SANS}`;
    c.fillText("ORDER CODE", W / 2, 348);
    c.lineWidth = 8;
    c.strokeStyle = "#1f9d5c";
    c.beginPath();
    c.ellipse(W / 2, 428, 372, 82, 0, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "#e03a3a";
    c.beginPath();
    c.ellipse(W / 2, 428, 356, 70, 0, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = "#fff";
    c.stroke();
    c.fillStyle = "#fff";
    c.font = `900 ${code.length > 11 ? 62 : 78}px ${MONO}`;
    c.textBaseline = "middle";
    c.fillText(code, W / 2, 432);
    c.textBaseline = "alphabetic";
    c.fillStyle = "#4f645a";
    c.font = `italic 600 27px ${SANS}`;
    c.fillText("Give this code to the delivery driver only when your goods arrive.", W / 2, 548);

    c.textAlign = "left";
    c.fillStyle = "#0f6b3d";
    c.font = `800 22px ${SANS}`;
    c.fillText("CUSTOMER", 70, 612);
    c.fillStyle = "#10261b";
    c.font = `800 38px ${SANS}`;
    c.fillText(fit(c, o.name, 700), 70, 658);
    c.font = `600 28px ${SANS}`;
    c.fillStyle = "#4f645a";
    c.fillText(String(o.phone || ""), 70, 698);
    c.font = `600 26px ${SANS}`;
    wrap(c, o.address || "", 700, 2).forEach((l, i) => c.fillText(l, 70, 734 + i * 34));

    c.textAlign = "right";
    c.fillStyle = "#0f6b3d";
    c.font = `800 22px ${SANS}`;
    c.fillText("DATE", W - 70, 612);
    c.fillStyle = "#10261b";
    c.font = `700 28px ${SANS}`;
    const d = new Date(o.createdAt || Date.now());
    c.fillText(d.toLocaleDateString("en-GB"), W - 70, 658);
    c.fillStyle = "#4f645a";
    c.font = `600 26px ${SANS}`;
    c.fillText(d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), W - 70, 698);
    tableTop = 800;
  }

  const rows = first
    ? o.items.slice(0, FIRST_ROWS)
    : o.items.slice(FIRST_ROWS + (page - 1) * NEXT_ROWS, FIRST_ROWS + page * NEXT_ROWS);

  c.fillStyle = "#0f6b3d";
  rr(c, 60, tableTop, W - 120, 58, 16);
  c.fill();
  c.fillStyle = "#fff";
  c.font = `800 24px ${SANS}`;
  c.textAlign = "left";
  c.fillText("ITEM", 90, tableTop + 38);
  c.textAlign = "center";
  c.fillText("QTY", 760, tableTop + 38);
  c.textAlign = "right";
  c.fillText("PRICE", 960, tableTop + 38);
  c.fillText("AMOUNT", W - 90, tableTop + 38);

  rows.forEach((it, i) => {
    const y = tableTop + 58 + i * ROW_H;
    if (i % 2 === 0) {
      c.fillStyle = "rgba(31,157,92,.08)";
      c.fillRect(60, y, W - 120, ROW_H);
    }
    c.fillStyle = "#10261b";
    c.textAlign = "left";
    c.font = `700 28px ${SANS}`;
    c.fillText(fit(c, `${it.name} (${it.unit || "Carton"})`, 560), 90, y + 42);
    c.textAlign = "center";
    c.font = `800 30px ${MONO}`;
    c.fillText(String(it.qty), 760, y + 42);
    c.textAlign = "right";
    c.font = `600 26px ${SANS}`;
    c.fillStyle = "#4f645a";
    c.fillText(money(it.price), 960, y + 42);
    c.fillStyle = "#10261b";
    c.font = `800 28px ${SANS}`;
    c.fillText(money(it.line), W - 90, y + 42);
  });
  c.strokeStyle = "rgba(16,38,27,.15)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(60, tableTop + 58 + rows.length * ROW_H + 2);
  c.lineTo(W - 60, tableTop + 58 + rows.length * ROW_H + 2);
  c.stroke();

  if (last) {
    c.fillStyle = "#0f6b3d";
    rr(c, 60, 1250, W - 120, 92, 46);
    c.fill();
    c.fillStyle = "#fff";
    c.textAlign = "left";
    c.font = `800 32px ${SANS}`;
    c.fillText("TOTAL TO PAY", 110, 1308);
    c.textAlign = "right";
    c.fillStyle = "#ffd166";
    c.font = `900 56px ${MONO}`;
    c.fillText(money(o.total), W - 110, 1312);

    const qy = 1372;
    const qs = 270;
    const drawQr = (cv, x, label) => {
      c.fillStyle = "#fff";
      rr(c, x - 14, qy - 14, qs + 28, qs + 28, 24);
      c.fill();
      c.strokeStyle = "#1f9d5c";
      c.lineWidth = 6;
      c.stroke();
      if (cv) c.drawImage(cv, x, qy, qs, qs);
      else {
        c.fillStyle = "#4f645a";
        c.textAlign = "center";
        c.font = `700 26px ${SANS}`;
        c.fillText(code, x + qs / 2, qy + qs / 2);
      }
      c.fillStyle = "#e03a3a";
      c.textAlign = "center";
      c.font = `28px ${SCRIPT}`;
      c.fillText(label, x + qs / 2, qy + qs + 54);
    };
    drawQr(qrDriver, 100, "Driver scan: confirm delivery");
    drawQr(qrSite, W - 100 - qs, "Visit our website");
    links.push({ x: 100, y: qy, w: qs, h: qs, uri: driverUrl(code) });
    links.push({ x: W - 100 - qs, y: qy, w: qs, h: qs, uri: SITE_URL });

    c.textAlign = "center";
    c.fillStyle = "#0f6b3d";
    c.font = `800 22px ${SANS}`;
    c.fillText("CALL OR WHATSAPP", W / 2, qy + 60);
    c.fillStyle = "#e03a3a";
    c.font = `900 46px ${MONO}`;
    c.fillText(PHONE_NUMBER, W / 2, qy + 120);
    links.push({ x: W / 2 - 230, y: qy + 80, w: 460, h: 56, uri: "tel:" + PHONE_NUMBER });
    c.fillStyle = "#10261b";
    c.font = `800 32px ${SANS}`;
    c.fillText("hamstore.com.ng", W / 2, qy + 184);
    links.push({ x: W / 2 - 200, y: qy + 150, w: 400, h: 48, uri: SITE_URL });
    c.fillStyle = "#4f645a";
    c.font = `italic 600 23px ${SANS}`;
    c.fillText("Keep this slip safe.", W / 2, qy + 232);
    c.fillText("Never share the code with anyone", W / 2, qy + 262);
    c.fillText("except the delivery driver.", W / 2, qy + 292);
  }

  c.fillStyle = "#0f6b3d";
  c.fillRect(0, H - 50, W, 50);
  c.fillStyle = "#fff";
  c.textAlign = "center";
  c.font = `700 22px ${SANS}`;
  c.fillText(`Hamstore Integrated Services  ·  ${SITE_URL.replace("https://", "")}  ·  ${PHONE_NUMBER}`, W / 2, H - 17);

  return { cv, links };
}

function toJpeg(cv) {
  return new Promise((res, rej) => {
    try {
      cv.toBlob(b => (b ? b.arrayBuffer().then(buf => res(new Uint8Array(buf))) : rej(new Error("blob"))), "image/jpeg", 0.9);
    } catch (e) { rej(e); }
  });
}

function buildPdf(pages) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let len = 0;
  const push = d => {
    const b = typeof d === "string" ? enc.encode(d) : d;
    parts.push(b);
    len += b.length;
  };
  let id = 3;
  const meta = pages.map(p => {
    const m = { img: id, cont: id + 1, page: id + 2, annots: p.links.map((_, k) => id + 3 + k) };
    id += 3 + p.links.length;
    return m;
  });
  const total = id;
  const PW = 595.28;
  const PH = 841.89;
  const sx = PW / W;
  const sy = PH / H;
  push("%PDF-1.4\n");
  const begin = n => { offsets[n] = len; push(`${n} 0 obj\n`); };
  begin(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  begin(2);
  push(`<< /Type /Pages /Kids [${meta.map(m => m.page + " 0 R").join(" ")}] /Count ${pages.length} >>\nendobj\n`);
  pages.forEach((p, i) => {
    const m = meta[i];
    begin(m.img);
    push(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg);
    push("\nendstream\nendobj\n");
    const content = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
    begin(m.cont);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    begin(m.page);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${m.img} 0 R >> >> /Contents ${m.cont} 0 R${m.annots.length ? ` /Annots [${m.annots.map(a => a + " 0 R").join(" ")}]` : ""} >>\nendobj\n`);
    p.links.forEach((l, k) => {
      const x1 = (l.x * sx).toFixed(2);
      const x2 = ((l.x + l.w) * sx).toFixed(2);
      const y1 = (PH - (l.y + l.h) * sy).toFixed(2);
      const y2 = (PH - l.y * sy).toFixed(2);
      begin(m.annots[k]);
      push(`<< /Type /Annot /Subtype /Link /Rect [${x1} ${y1} ${x2} ${y2}] /Border [0 0 0] /A << /S /URI /URI (${l.uri.replace(/[()\\]/g, "")}) >> >>\nendobj\n`);
    });
  });
  const xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  x += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  push(x);
  const out = new Uint8Array(len);
  let pos = 0;
  parts.forEach(b => { out.set(b, pos); pos += b.length; });
  return new Blob([out], { type: "application/pdf" });
}

export async function makeSlip(order) {
  const o = {
    code: String(order.code || ""),
    name: String(order.name || ""),
    phone: String(order.phone || ""),
    address: String(order.address || ""),
    createdAt: Number(order.createdAt) || Date.now(),
    total: Number(order.total) || 0,
    items: (order.items || []).map(i => ({
      name: String(i.name || ""),
      unit: String(i.unit || "Carton"),
      qty: Number(i.qty) || 0,
      price: Number(i.price) || 0,
      line: Number(i.line) || (Number(i.price) || 0) * (Number(i.qty) || 0)
    }))
  };
  try { await document.fonts.load("44px Lobster"); } catch (e) {}
  const [logo, qrDriver, qrSite] = await Promise.all([loadImg(LOGO), qrCanvas(driverUrl(o.code), 270), qrCanvas(SITE_URL, 270)]);
  const count = pageCount(o.items.length);
  const build = async useLogo => {
    const out = [];
    for (let p = 0; p < count; p++) {
      const r = paint(o, p, count, useLogo ? logo : null, qrDriver, qrSite);
      out.push({ jpeg: await toJpeg(r.cv), links: r.links });
    }
    return out;
  };
  let pages;
  try {
    pages = await build(true);
  } catch (e) {
    pages = await build(false);
  }
  return buildPdf(pages);
}

export async function downloadSlip(order) {
  const blob = await makeSlip(order);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "hamstore-" + String(order.code || "slip").replace(/[^A-Za-z0-9-]/g, "-") + ".pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function shareSlip(order) {
  const blob = await makeSlip(order);
  const file = new File([blob], "hamstore-" + String(order.code || "slip").replace(/[^A-Za-z0-9-]/g, "-") + ".pdf", { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Hamstore " + order.code, text: "Hamstore order " + order.code });
      return true;
    } catch (e) {
      if (e && e.name === "AbortError") return true;
    }
  }
  await downloadSlip(order);
  return false;
}
