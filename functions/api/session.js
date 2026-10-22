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

let jwks = { keys: null, exp: 0 };

async function verifyIdToken(env, idToken) {
  const pid = serviceAccount(env).project_id;
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("jwt");
  const dec = s => JSON.parse(new TextDecoder().decode(fromB64u(s)));
  const header = dec(parts[0]);
  const payload = dec(parts[1]);
  if (header.alg !== "RS256") throw new Error("alg");
  if (!jwks.keys || Date.now() > jwks.exp) {
    const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    const j = await r.json();
    jwks = { keys: j.keys || [], exp: Date.now() + 3600000 };
  }
  const jwk = jwks.keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error("kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  const now = Math.floor(Date.now() / 1000);
  if (!ok || payload.aud !== pid || payload.iss !== "https://securetoken.google.com/" + pid || !payload.sub || payload.exp < now || payload.iat > now + 300) throw new Error("claims");
  return payload;
}

const ALLOWED = [
  "9895309c5a60b565a954320709e9e577f10b6f716f84bd3bba11401ee152828f",
  "765fde4719164d0a4222efeba13a8cb81f62c581449af59546fb46b52345710f",
  "df628e3c4aabaa832553f4b73f629ff3cc9da2822d6138c98219bc7cfc2ff5d3",
  "9231a6f06602a95ae0bf724054383fc17a731389b91ac80096370b3ba200e292",
  "5a0a9ac1137cf7420601fa2a5d71f4759fe8aae27620058062bc05b6a4715a7c"
];

const sha256 = async text => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
};

export async function onRequestPost({ request, env }) {
  let input;
  try {
    input = await request.json();
  } catch (e) {
    return reply({ ok: false, code: "bad" }, 400);
  }
  if (!env.FIREBASE_SERVICE_KEY) return reply({ ok: false, code: "server" }, 500);

  let who;
  try {
    who = await verifyIdToken(env, input.idToken);
  } catch (e) {
    return reply({ ok: false, code: "token" }, 401);
  }

  const email = String(who.email || "").trim().toLowerCase();
  try {
    const allowed = !!email && ALLOWED.includes(await sha256(email));
    const current = await rt(env, "GET", "admins/" + who.sub);
    if (!allowed) {
      if (current !== null) await rt(env, "DELETE", "admins/" + who.sub);
      return reply({ ok: false, code: "notallowed" }, 403);
    }
    if (who.email_verified !== true) return reply({ ok: false, code: "unverified" }, 403);
    if (current !== true) await rt(env, "PUT", "admins/" + who.sub, true);
    return reply({ ok: true });
  } catch (e) {
    return reply({ ok: false, code: "server" }, 500);
  }
}

export async function onRequest() {
  return reply({ ok: false }, 405);
}
