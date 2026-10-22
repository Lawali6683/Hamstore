const DB_URL = "https://hamstore-751c1-default-rtdb.firebaseio.com";
const SCOPE = "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email";

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

const fromB64u = text => {
  let s = text.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
};

const serviceAccount = env => {
  const sa = JSON.parse(env.FIREBASE_SERVICE_KEY);
  sa.private_key = String(sa.private_key || "").replace(/\\n/g, "\n");
  return sa;
};

let cached = { token: null, exp: 0 };

async function getAccessToken(env) {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const sa = serviceAccount(env);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
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
  if (!json.access_token) throw new Error("token " + (json.error || ""));
  cached = { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return cached.token;
}

async function rt(env, method, path, body) {
  const token = await getAccessToken(env);
  const res = await fetch(`${DB_URL}/${path}.json`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) throw new Error("db " + res.status);
  return res.json();
}

async function rateLimit(env, request, bucket, seconds) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bucket + ip));
  const id = [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
  const path = `rate/${bucket}-${id}`;
  const prev = await rt(env, "GET", path);
  const now = Date.now();
  if (typeof prev === "number" && now - prev < seconds * 1000) return false;
  await rt(env, "PUT", path, now);
  return true;
}

const PHONE = /^[0-9+\s-]{7,20}$/;

export async function onRequestPost({ request, env }) {
  let input;
  try {
    input = await request.json();
  } catch (e) {
    return reply({ ok: false, code: "bad" }, 400);
  }
  if (!env.FIREBASE_SERVICE_KEY) return reply({ ok: false, code: "server" }, 500);

  const name = String(input.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const phone = String(input.phone || "").trim();
  const address = String(input.address || "").trim().slice(0, 200);
  const shot = String(input.shot || "").trim();
  const rows = Array.isArray(input.items) ? input.items.slice(0, 40) : [];

  if (name.length < 2) return reply({ ok: false, code: "name" }, 400);
  if (!PHONE.test(phone)) return reply({ ok: false, code: "phone" }, 400);
  if (address.length < 5) return reply({ ok: false, code: "address" }, 400);
  if (!/^https:\/\/i\.imgur\.com\/[A-Za-z0-9]+\.(jpg|jpeg|png|gif)$/.test(shot)) return reply({ ok: false, code: "shot" }, 400);

  const wanted = new Map();
  for (const r of rows) {
    const id = String(r.id || "");
    const qty = Math.floor(Number(r.qty));
    if (!/^POST\d{4,}$/.test(id) || !(qty >= 1 && qty <= 999)) return reply({ ok: false, code: "items" }, 400);
    wanted.set(id, (wanted.get(id) || 0) + qty);
  }
  if (!wanted.size) return reply({ ok: false, code: "items" }, 400);

  try {
    if (!(await rateLimit(env, request, "pay", 20))) return reply({ ok: false, code: "wait" }, 429);
    const token = await getAccessToken(env);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const shop = await fetch(`${DB_URL}/settings/shop/open.json`, { headers }).then(r => r.json());
    if (shop === "no") return reply({ ok: false, code: "closed" }, 403);

    const items = [];
    let total = 0;
    for (const [id, qty] of wanted) {
      const p = await fetch(`${DB_URL}/posts/${id}.json`, { headers }).then(r => r.json());
      if (!p || typeof p.price !== "number") return reply({ ok: false, code: "gone", id }, 409);
      const line = p.price * qty;
      total += line;
      items.push({ id, name: String(p.name).slice(0, 80), unit: p.unit, price: p.price, qty, line });
    }

    const yy = String(new Date().getFullYear()).slice(-2);
    const n = (crypto.getRandomValues(new Uint32Array(1))[0] % 90000) + 10000;
    const code = `Pay/${yy}/${n}`;
    const rec = { code, name, phone, address, shot, items, total, status: "pending", createdAt: Date.now() };
    const created = await fetch(`${DB_URL}/payments.json`, { method: "POST", headers, body: JSON.stringify(rec) }).then(r => r.json());
    if (!created || !created.name) throw new Error("save");
    return reply({ ok: true, code, total, items, createdAt: rec.createdAt }, 201);
  } catch (e) {
    return reply({ ok: false, code: "server" }, 500);
  }
}

export async function onRequest() {
  return reply({ ok: false }, 405);
}
