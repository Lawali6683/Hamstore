const DB_URL = "https://hamstore-751c1-default-rtdb.firebaseio.com";
const SCOPE = "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/identitytoolkit";

const reply = (data, status = 200, origin = "*") => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
};

const b64url = input => {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let s = "";
  bytes.forEach(b => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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

const AUTH_API = "https://identitytoolkit.googleapis.com/v1/projects/";

export async function onRequest({ request, env }) {
  const origin = request.headers.get("Origin") || "*";
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  if (request.method !== "POST") {
    return reply({ ok: false, message: "Method not allowed." }, 405, origin);
  }

  let input;
  try {
    input = await request.json();
  } catch (e) {
    return reply({ ok: false, code: "bad", message: "Invalid request." }, 400, origin);
  }

  const name = String(input.name || "").trim().replace(/\s+/g, " ");
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");

  if (name.length < 2 || name.length > 60) return reply({ ok: false, code: "name", message: "Enter your full name." }, 400, origin);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return reply({ ok: false, code: "email", message: "Enter a valid email." }, 400, origin);
  if (password.length < 8 || password.length > 128) return reply({ ok: false, code: "password", message: "Password must be at least 8 characters." }, 400, origin);
  if (!env.FIREBASE_SERVICE_KEY) return reply({ ok: false, code: "server", message: "Server is not set up yet. Add FIREBASE_SERVICE_KEY in Cloudflare." }, 500, origin);

  let uid = "";
  try {
    const token = await getAccessToken(env);
    const sa = serviceAccount(env);
    const res = await fetch(`${AUTH_API}${sa.project_id}/accounts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName: name, emailVerified: false })
    });
    const json = await res.json();
    if (!res.ok) {
      const detail = String((json.error && json.error.message) || res.statusText || res.status);
      if (detail.includes("EMAIL_EXISTS")) return reply({ ok: false, code: "exists", message: "This email is already registered. Log in instead.", detail }, 409, origin);
      if (detail.includes("WEAK_PASSWORD")) return reply({ ok: false, code: "password", message: "Password is too weak.", detail }, 400, origin);
      if (detail.includes("INVALID_EMAIL")) return reply({ ok: false, code: "email", message: "Enter a valid email.", detail }, 400, origin);
      return reply({ ok: false, code: "auth", message: "Could not create the account. Check that Email/Password is enabled in Firebase Authentication.", detail }, 502, origin);
    }
    uid = json.localId;
  } catch (e) {
    return reply({ ok: false, code: "server", message: "The server could not reach Firebase. Check FIREBASE_SERVICE_KEY.", detail: String(e.message || e) }, 500, origin);
  }

  try {
    await rt(env, "PUT", "users/" + uid, { name, email, createdAt: Date.now() });
  } catch (e) {
    return reply({ ok: true, code: "noprofile", message: "Account created. You can log in now." }, 201, origin);
  }

  return reply({ ok: true, message: "Account created. You can log in now." }, 201, origin);
}

export async function onRequestGet() {
  return reply({ ok: false, message: "Method not allowed." }, 405);
}
