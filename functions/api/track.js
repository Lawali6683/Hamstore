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

const same = (a, b) => {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

const num = v => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

const distanceKm = (a, b) => {
  const r = x => (x * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

export async function onRequestPost({ request, env }) {
  let input;
  try {
    input = await request.json();
  } catch (e) {
    return reply({ ok: false }, 400);
  }

  const id = String(input.id || "");
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const speed = Math.max(0, Math.min(300, Number(input.speed) || 0));

  if (!/^VEH\d{4,}$/.test(id) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return reply({ ok: false }, 400);
  }
  if (!env.FIREBASE_SERVICE_KEY) return reply({ ok: false }, 500);

  try {
    const token = await getAccessToken(env);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const vehicle = await fetch(`${DB_URL}/vehicles/${id}.json`, { headers }).then(r => r.json());
    if (!vehicle || !same(vehicle.key, input.key)) return reply({ ok: false }, 401);

    const prev = await fetch(`${DB_URL}/tracking/${id}.json`, { headers }).then(r => r.json());
    const now = Date.now();
    const rec = { lat, lng, speed, ts: now };
    const head = num(input.head);
    const bat = num(input.bat);
    if (head !== null) rec.head = Math.round(head) % 360;
    if (bat !== null) rec.bat = Math.max(0, Math.min(100, Math.round(bat)));
    await fetch(`${DB_URL}/tracking/${id}.json`, { method: "PUT", headers, body: JSON.stringify(rec) });

    if (!prev || distanceKm(prev, { lat, lng }) > 0.02 || now - prev.ts > 60000) {
      await fetch(`${DB_URL}/trails/${id}.json`, { method: "POST", headers, body: JSON.stringify({ lat, lng, t: now }) });
    }
    return reply({ ok: true });
  } catch (e) {
    return reply({ ok: false }, 500);
  }
}

export async function onRequest() {
  return reply({ ok: false }, 405);
}