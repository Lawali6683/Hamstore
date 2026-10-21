const DB_URL = "https://hamstore-751c1-default-rtdb.firebaseio.com";
const API_KEY = "AIzaSyBD72eK0MSFWhfSjh1rs2TZaDrAApX1Auk";

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

const AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts";

const post = (path, payload) =>
  fetch(`${AUTH_URL}:${path}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then(r => r.json());

export async function onRequestPost({ request, env }) {
  let input;
  try {
    input = await request.json();
  } catch (e) {
    return reply({ ok: false, message: "Invalid request." }, 400);
  }

  const name = String(input.name || "").trim().replace(/\s+/g, " ");
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");

  if (name.length < 2 || name.length > 60) return reply({ ok: false, message: "Enter your full name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return reply({ ok: false, message: "Enter a valid email." }, 400);
  if (password.length < 8 || password.length > 128) return reply({ ok: false, message: "Password must be at least 8 characters." }, 400);
  if (!env.FIREBASE_SERVICE_KEY) return reply({ ok: false, message: "Server is not set up yet." }, 500);

  const created = await post("signUp", { email, password, returnSecureToken: true });
  if (created.error) {
    const code = created.error.message || "";
    if (code.startsWith("EMAIL_EXISTS")) return reply({ ok: false, message: "This email is already registered." }, 409);
    if (code.startsWith("WEAK_PASSWORD")) return reply({ ok: false, message: "Password is too weak." }, 400);
    return reply({ ok: false, message: "Could not create the account." }, 400);
  }

  try {
    await post("update", { idToken: created.idToken, displayName: name, returnSecureToken: false });
    const token = await getAccessToken(env);
    const saved = await fetch(`${DB_URL}/users/${created.localId}.json`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, createdAt: Date.now() })
    });
    if (!saved.ok) throw new Error("db");
  } catch (e) {
    return reply({ ok: false, message: "Account created but profile was not saved. Contact support." }, 500);
  }

  return reply({ ok: true, message: "Account created. You can log in now." }, 201);
}

export async function onRequest() {
  return reply({ ok: false, message: "Method not allowed." }, 405);
}
