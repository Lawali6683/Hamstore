const SB_URL = "https://eqbrczrlxwffvizjcdvu.supabase.co";

const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const sbHeaders = (env, extra = {}) => {
  const k = env.SUPABASE_API_KEY;
  const h = { apikey: k, "Content-Type": "application/json", ...extra };
  if (k.startsWith("eyJ")) h.Authorization = `Bearer ${k}`;
  return h;
};

async function db(env, path, init = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: sbHeaders(env, init.headers) });
  if (!res.ok) throw new Error(`db ${res.status} ${await res.text()}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

const same = (a, b) => {
  a = String(a || "");
  b = String(b || "");
  if (a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

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
  if (!env.SUPABASE_API_KEY) return reply({ ok: false, message: "Server is not set up yet." }, 500);

  try {
    const rows = await db(env, `vehicles?select=id,key,name,plate,driver_name,confirmed_at&code_key=eq.${code}`);
    if (!rows || !rows.length) return reply({ ok: false, message: "This code was not found." }, 404);

    const vehicle = rows[0];
    if (!same(vehicle.key, key)) return reply({ ok: false, message: "This link is not valid." }, 401);

    if (!vehicle.confirmed_at) {
      await db(env, `vehicles?id=eq.${vehicle.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ confirmed_at: Date.now() }),
      });
    }
    return reply({ ok: true, id: vehicle.id, name: vehicle.name, plate: vehicle.plate, driver: vehicle.driver_name || "" });
  } catch (e) {
    return reply({ ok: false, message: "Something went wrong. Try again." }, 500);
  }
}

export async function onRequest() {
  return reply({ ok: false, message: "Method not allowed." }, 405);
}
