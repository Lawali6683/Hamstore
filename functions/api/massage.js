const DB_URL = "https://hamstore-751c1-default-rtdb.firebaseio.com";

const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

const b64url = input => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = "";
  bytes.forEach(b => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let cached = { token: null, exp: 0 };

async function getAccessToken(env) {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const sa = JSON.parse(env.FIREBASE_SERVICE_KEY);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + body));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: head + "." + body + "." + b64url(sig)
    })
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("token");
  cached = { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return cached.token;
}

async function rateLimit(env, request, bucket, seconds) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bucket + ip));
  const id = [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
  const token = await getAccessToken(env);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const url = `${DB_URL}/rate/${bucket}-${id}.json`;
  const prev = await fetch(url, { headers }).then(r => r.json());
  const now = Date.now();
  if (typeof prev === "number" && now - prev < seconds * 1000) return false;
  await fetch(url, { method: "PUT", headers, body: String(now) });
  return true;
}

const KINDS = ["order", "stock", "message"];
const PHONE = /^[0-9+\s-]{7,20}$/;

export async function onRequestPost({ request, env }) {
  let input;
  try {
    input = await request.json();
  } catch (e) {
    return reply({ ok: false, code: "bad" }, 400);
  }
  if (!env.FIREBASE_SERVICE_KEY) return reply({ ok: false, code: "server" }, 500);

  const name = String(input.name || "").trim().replace(/\s+/g, " ").slice(0, 80) || "Customer";
  const phone = String(input.phone || "").trim();
  const kind = KINDS.includes(input.kind) ? input.kind : "message";
  const message = String(input.message || "").trim().slice(0, 600);
  const address = String(input.address || "").trim().slice(0, 200);
  const branchId = /^BRANCH\d{4,}$/.test(String(input.branchId || "")) ? input.branchId : "";
  const audio = typeof input.audio === "string" ? input.audio : "";
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const hasPos = input.lat !== undefined && input.lat !== null && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  if (!PHONE.test(phone)) return reply({ ok: false, code: "phone" }, 400);
  if (!message && !audio) return reply({ ok: false, code: "empty" }, 400);
  if (audio && (!/^data:audio\/[a-z0-9.+-]+(;codecs=[a-z0-9.,]+)?;base64,/i.test(audio) || audio.length > 450000)) return reply({ ok: false, code: "audio" }, 400);

  try {
    if (!(await rateLimit(env, request, "msg", 20))) return reply({ ok: false, code: "wait" }, 429);
    const token = await getAccessToken(env);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const rec = { name, phone, kind, status: "new", createdAt: Date.now() };
    if (message) rec.message = message;
    if (address) rec.address = address;
    if (hasPos) { rec.lat = lat; rec.lng = lng; }
    if (audio) rec.voice = true;
    if (branchId) {
      const bn = await fetch(`${DB_URL}/branches/${branchId}/name.json`, { headers }).then(r => r.json());
      if (bn) { rec.branchId = branchId; rec.branchName = String(bn).slice(0, 80); }
    }

    const created = await fetch(`${DB_URL}/requests.json`, { method: "POST", headers, body: JSON.stringify(rec) }).then(r => r.json());
    if (!created || !created.name) throw new Error("save");
    if (audio) {
      await fetch(`${DB_URL}/voices/${created.name}.json`, { method: "PUT", headers, body: JSON.stringify({ data: audio, createdAt: rec.createdAt }) });
    }
    return reply({ ok: true, ref: created.name.slice(-6).toUpperCase() }, 201);
  } catch (e) {
    return reply({ ok: false, code: "server" }, 500);
  }
}

export async function onRequest() {
  return reply({ ok: false }, 405);
}