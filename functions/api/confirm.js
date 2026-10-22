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

const same = (a, b) => {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

export async function onRequestPost({ request, env }) {
  let input;
  try {
    input = await request.json();
  } catch (e) {
    return reply({ ok: false, message: "Invalid request." }, 400);
  }

  const code = String(input.code || "").trim().toLowerCase().replace(/[\/\s]+/g, "-");
  const key = String(input.key || "").trim();
  if (!/^ham-\d{2}-\d{5}$/.test(code) || key.length < 8) return reply({ ok: false, message: "Check the code and the link." }, 400);
  if (!env.FIREBASE_SERVICE_KEY) return reply({ ok: false, message: "Server is not set up yet." }, 500);

  try {
    const token = await getAccessToken(env);
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const id = await fetch(`${DB_URL}/codes/${code}.json`, { headers }).then(r => r.json());
    if (!id) return reply({ ok: false, message: "This code was not found." }, 404);
    const vehicle = await fetch(`${DB_URL}/vehicles/${id}.json`, { headers }).then(r => r.json());
    if (!vehicle || !same(vehicle.key, key)) return reply({ ok: false, message: "This link is not valid." }, 401);
    if (!vehicle.confirmedAt) {
      await fetch(`${DB_URL}/vehicles/${id}.json`, { method: "PATCH", headers, body: JSON.stringify({ confirmedAt: Date.now() }) });
    }
    return reply({ ok: true, id, name: vehicle.name, plate: vehicle.plate, driver: vehicle.driverName || "" });
  } catch (e) {
    return reply({ ok: false, message: "Something went wrong. Try again." }, 500);
  }
}

export async function onRequest() {
  return reply({ ok: false, message: "Method not allowed." }, 405);
}
