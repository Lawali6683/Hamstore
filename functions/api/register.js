const SB_URL = "https://eqbrczrlxwffvizjcdvu.supabase.co";

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
});

const reply = (data, status = 200, origin = "*") =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(origin),
    },
  });

const sbHeaders = (env, extra = {}) => {
  const k = env.SUPABASE_API_KEY;
  const h = { apikey: k, "Content-Type": "application/json", ...extra };
  if (k.startsWith("eyJ")) h.Authorization = `Bearer ${k}`;
  return h;
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
  if (!env.SUPABASE_API_KEY) {
    return reply({ ok: false, code: "server", message: "Server is not set up yet. Add SUPABASE_API_KEY in Cloudflare." }, 500, origin);
  }

  let uid = "";
  let needsConfirm = true;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/signup`, {
      method: "POST",
      headers: sbHeaders(env),
      body: JSON.stringify({ email, password, data: { name } }),
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      const detail = String(json.error_code || json.msg || json.message || res.statusText || res.status);
      const low = detail.toLowerCase();
      if (low.includes("already") || low.includes("exists")) {
        return reply({ ok: false, code: "exists", message: "This email is already registered. Log in instead.", detail }, 409, origin);
      }
      if (low.includes("weak_password") || low.includes("password")) {
        return reply({ ok: false, code: "password", message: "Password is too weak.", detail }, 400, origin);
      }
      if (low.includes("email_address_invalid") || low.includes("invalid")) {
        return reply({ ok: false, code: "email", message: "Enter a valid email.", detail }, 400, origin);
      }
      if (res.status === 429 || low.includes("rate")) {
        return reply({ ok: false, code: "wait", message: "Too many attempts. Try again in a few minutes.", detail }, 429, origin);
      }
      return reply({ ok: false, code: "auth", message: "Could not create the account.", detail }, 502, origin);
    }

    const user = json.user || json;
    uid = user.id || "";
    
    needsConfirm = !json.access_token;
  } catch (e) {
    return reply({ ok: false, code: "server", message: "The server could not reach Supabase. Check SUPABASE_API_KEY.", detail: String(e.message || e) }, 500, origin);
  }

  if (uid) {
    try {
      await fetch(`${SB_URL}/rest/v1/profiles?on_conflict=id`, {
        method: "POST",
        headers: sbHeaders(env, { Prefer: "resolution=merge-duplicates,return=minimal" }),
        body: JSON.stringify({ id: uid, name, email }),
      });
    } catch (e) {
      
    }
  }

  return reply({
    ok: true,
    needsConfirm,
    message: needsConfirm
      ? "Account created. Check your email to confirm, then log in."
      : "Account created. You can log in now.",
  }, 201, origin);
}
