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
  if (!env.SUPABASE_API_KEY) return reply({ ok: false }, 500);

  try {
    const veh = await db(env, `vehicles?select=key&id=eq.${id}`);
    if (!veh || !veh.length || !same(veh[0].key, input.key)) return reply({ ok: false }, 401);

    const prevRows = await db(env, `tracking?select=lat,lng,ts&vehicle_id=eq.${id}`);
    const prev = prevRows && prevRows[0];
    const now = Date.now();

    const head = num(input.head);
    const bat = num(input.bat);
    const rec = {
      vehicle_id: id,
      lat,
      lng,
      speed,
      ts: now,
      head: head !== null ? Math.round(head) % 360 : null,
      bat: bat !== null ? Math.max(0, Math.min(100, Math.round(bat))) : null,
    };

    await db(env, "tracking?on_conflict=vehicle_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rec),
    });

    if (!prev || distanceKm(prev, { lat, lng }) > 0.02 || now - Number(prev.ts) > 60000) {
      await db(env, "trails", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ vehicle_id: id, lat, lng, t: now }),
      });
    }
    return reply({ ok: true });
  } catch (e) {
    return reply({ ok: false }, 500);
  }
}

export async function onRequest() {
  return reply({ ok: false }, 405);
}
