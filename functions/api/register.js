const DB_URL = "https://hamstore-751c1-default-rtdb.firebaseio.com";

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});

const reply = (data, status = 200, origin = "*") => {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(origin)
    }
  });
};

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
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

  if (name.length < 2 || name.length > 60) {
    return reply({ ok: false, code: "name", message: "Enter your full name." }, 400, origin);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return reply({ ok: false, code: "email", message: "Enter a valid email." }, 400, origin);
  }
  if (password.length < 8 || password.length > 128) {
    return reply({ ok: false, code: "password", message: "Password must be at least 8 characters." }, 400, origin);
  }
  if (!env.FIREBASE_SERVICE_KEY) {
    return reply({ ok: false, code: "server", message: "Server is not set up yet. Add FIREBASE_SERVICE_KEY in Cloudflare." }, 500, origin);
  }

  let uid = "";
  try {
    const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${env.FIREBASE_SERVICE_KEY}`;
    const res = await fetch(authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const json = await res.json();

    if (!res.ok) {
      const detail = String((json.error && json.error.message) || res.statusText || res.status);
      if (detail.includes("EMAIL_EXISTS")) {
        return reply({ ok: false, code: "exists", message: "This email is already registered. Log in instead.", detail }, 409, origin);
      }
      if (detail.includes("WEAK_PASSWORD")) {
        return reply({ ok: false, code: "password", message: "Password is too weak.", detail }, 400, origin);
      }
      if (detail.includes("INVALID_EMAIL")) {
        return reply({ ok: false, code: "email", message: "Enter a valid email.", detail }, 400, origin);
      }
      return reply({ ok: false, code: "auth", message: "Could not create the account. Check that Email/Password is enabled in Firebase Authentication.", detail }, 502, origin);
    }

    uid = json.localId;
  } catch (e) {
    return reply({ ok: false, code: "server", message: "The server could not reach Firebase. Check API key.", detail: String(e.message || e) }, 500, origin);
  }

  try {
    const dbRes = await fetch(`${DB_URL}/users/${uid}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, createdAt: Date.now() })
    });
    if (!dbRes.ok) {
      throw new Error("Failed to save user profile");
    }
  } catch (e) {
    return reply({ ok: true, code: "noprofile", message: "Account created. You can log in now." }, 201, origin);
  }

  return reply({ ok: true, message: "Account created. You can log in now." }, 201, origin);
}
