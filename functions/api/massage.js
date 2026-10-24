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

const KINDS = ["order", "stock", "message"];
const PHONE = /^[0-9+\s-]{7,20}$/;

export async function onRequestPost({ request, env }) {
  let input;
  try {
    input = await request.json();
  } catch (e) {
    return reply({ ok: false, code: "bad" }, 400);
  }
  if (!env.SUPABASE_API_KEY) return reply({ ok: false, code: "server" }, 500);

  const name = String(input.name || "").trim().replace(/\s+/g, " ").slice(0, 80) || "Customer";
  const phone = String(input.phone || "").trim();
  const kind = KINDS.includes(input.kind) ? input.kind : "message";
  const message = String(input.message || "").trim().slice(0, 600);
  const address = String(input.address || "").trim().slice(0, 200);
  const branchId = /^BRANCH\d{4,}$/.test(String(input.branchId || "")) ? input.branchId : "";
  const audio = typeof input.audio === "string" ? input.audio : "";
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const hasPos = input.lat !== undefined && input.lat !== null && input.lat !== "" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  if (!PHONE.test(phone)) return reply({ ok: false, code: "phone" }, 400);
  if (!message && !audio) return reply({ ok: false, code: "empty" }, 400);
  if (audio && (!/^data:audio\/[a-z0-9.+-]+(;codecs=[a-z0-9.,]+)?;base64,/i.test(audio) || audio.length > 450000)) return reply({ ok: false, code: "audio" }, 400);

  try {
    if (!(await rateLimit(env, request, "msg", 20))) return reply({ ok: false, code: "wait" }, 429);

    const createdAt = Date.now();
    const rec = { name, phone, kind, status: "new", created_at: createdAt, voice: !!audio };
    if (message) rec.message = message;
    if (address) rec.address = address;
    if (hasPos) { rec.lat = lat; rec.lng = lng; }

    if (branchId) {
      const bn = await db(env, `branches?select=name&id=eq.${branchId}`);
      if (bn && bn[0] && bn[0].name) {
        rec.branch_id = branchId;
        rec.branch_name = String(bn[0].name).slice(0, 80);
      }
    }

    const saved = await db(env, "requests", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(rec),
    });
    if (!saved || !saved[0] || !saved[0].id) throw new Error("save");
    const reqId = saved[0].id;

    if (audio) {
      await db(env, "voices", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ request_id: reqId, data: audio, created_at: createdAt }),
      });
    }

    return reply({ ok: true, ref: String(reqId).replace(/-/g, "").slice(0, 6).toUpperCase() }, 201);
  } catch (e) {
    return reply({ ok: false, code: "server" }, 500);
  }
}

export async function onRequest() {
  return reply({ ok: false }, 405);
}
