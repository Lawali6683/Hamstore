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

async function rateLimit(env, request, bucket, seconds) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bucket + ip));
  const id = [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
  const key = `${bucket}-${id}`;
  const rows = await db(env, `rate_limits?select=ts&key=eq.${key}`);
  const now = Date.now();
  const prev = rows && rows[0] ? Number(rows[0].ts) : null;
  if (prev !== null && now - prev < seconds * 1000) return false;
  await db(env, "rate_limits?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key, ts: now }),
  });
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
  if (!env.SUPABASE_API_KEY) return reply({ ok: false, code: "server" }, 500);

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

    const shop = await db(env, "settings?select=value&key=eq.shop_open");
    if (shop && shop[0] && shop[0].value === "no") return reply({ ok: false, code: "closed" }, 403);

    const ids = [...wanted.keys()];
    const found = await db(env, `posts?select=id,name,unit,price&id=in.(${ids.join(",")})`);
    const byId = new Map((found || []).map(p => [p.id, p]));

    const items = [];
    let total = 0;
    for (const [id, qty] of wanted) {
      const p = byId.get(id);
      const price = p ? Number(p.price) : NaN;
      if (!p || !Number.isFinite(price)) return reply({ ok: false, code: "gone", id }, 409);
      const line = price * qty;
      total += line;
      items.push({ id, name: String(p.name).slice(0, 80), unit: p.unit, price, qty, line });
    }

    const yy = String(new Date().getFullYear()).slice(-2);
    const n = (crypto.getRandomValues(new Uint32Array(1))[0] % 90000) + 10000;
    const code = `Pay/${yy}/${n}`;
    const createdAt = Date.now();

    const saved = await db(env, "payments", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ code, name, phone, address, shot, items, total, status: "pending", created_at: createdAt }),
    });
    if (!saved || !saved[0]) throw new Error("save");

    return reply({ ok: true, code, total, items, createdAt }, 201);
  } catch (e) {
    return reply({ ok: false, code: "server" }, 500);
  }
}

export async function onRequest() {
  return reply({ ok: false }, 405);
}
