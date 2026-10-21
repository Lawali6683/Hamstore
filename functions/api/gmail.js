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

let gmail = { token: null, exp: 0 };

async function gmailToken(env) {
  if (gmail.token && Date.now() < gmail.exp - 60000) return gmail.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("gmail token");
  gmail = { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return gmail.token;
}

const utf8b64 = text => {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  bytes.forEach(b => (s += String.fromCharCode(b)));
  return btoa(s);
};

const wrap = text => utf8b64(text).replace(/.{1,76}/g, "$&\r\n");

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const plainText = v =>
  `Hello ${v.name},\n\nYour vehicle ${v.vehicle} (${v.plate}) is registered with Hamstore.\n\nYour ID: ${v.code}\n\nOpen this link on your phone to confirm and start tracking:\n${v.link}\n\nHamstore`;

const htmlBody = v => `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eef4f0;font-family:Arial,Helvetica,sans-serif;color:#10261a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef4f0;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:18px;overflow:hidden">
<tr><td style="height:6px;background:linear-gradient(90deg,#e03a3a,#2fb36d)"></td></tr>
<tr><td align="center" style="padding:28px 24px 8px"><img src="https://i.imgur.com/UXH5q5w.png" alt="Hamstore" height="64" style="display:block;height:64px;width:auto;border:0"></td></tr>
<tr><td style="padding:8px 28px 0"><h1 style="margin:0 0 8px;font-size:22px">Hello ${esc(v.name)},</h1>
<p style="margin:0;font-size:15px;line-height:1.6;color:#41584b">Your vehicle <b>${esc(v.vehicle)}</b> (${esc(v.plate)}) is now registered with Hamstore.</p></td></tr>
<tr><td style="padding:20px 28px 0"><div style="background:#f1f8f4;border:1px solid #cfe6d8;border-radius:14px;padding:18px;text-align:center">
<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#5b7566">Your ID</div>
<div style="font-family:Consolas,Menlo,monospace;font-size:30px;font-weight:700;color:#1b7d49;margin-top:6px">${esc(v.code)}</div></div></td></tr>
<tr><td style="padding:20px 28px 0"><p style="margin:0;font-size:15px;line-height:1.6;color:#41584b">Open the button below on the phone that stays in the vehicle. Follow the steps to confirm your ID and start sharing the vehicle location.</p></td></tr>
<tr><td align="center" style="padding:24px 28px"><a href="${esc(v.link)}" style="display:inline-block;background:#1b7d49;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:15px 30px;border-radius:12px">Confirm and start tracking</a></td></tr>
<tr><td style="padding:0 28px 26px"><p style="margin:0;font-size:12.5px;line-height:1.6;color:#7a8f83;word-break:break-all">If the button does not work, copy this link:<br>${esc(v.link)}</p></td></tr>
<tr><td style="background:#f6faf8;padding:16px 28px;font-size:12px;color:#7a8f83;text-align:center">Hamstore &middot; Drinks and water distribution</td></tr>
</table></td></tr></table></body></html>`;

export async function onRequestPost({ request, env }) {
  let input;
  try {
    input = await request.json();
  } catch (e) {
    return reply({ ok: false, message: "Invalid request." }, 400);
  }

  if (!env.FIREBASE_SERVICE_KEY || !env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
    return reply({ ok: false, message: "Email is not set up on the server yet." }, 500);
  }

  const origin = new URL(request.url).origin;
  const v = {
    to: String(input.to || "").trim(),
    name: String(input.name || "").trim().slice(0, 80) || "driver",
    vehicle: String(input.vehicle || "").trim().slice(0, 80),
    plate: String(input.plate || "").trim().slice(0, 20),
    code: String(input.code || "").trim(),
    link: String(input.link || "").trim()
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.to)) return reply({ ok: false, message: "Enter a valid email." }, 400);
  if (!/^Ham\/\d{2}\/\d{5}$/i.test(v.code)) return reply({ ok: false, message: "Invalid code." }, 400);
  if (!v.link.startsWith(origin + "/confirm.html?") || v.link.length > 400) return reply({ ok: false, message: "Invalid link." }, 400);

  try {
    const lookup = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: String(input.idToken || "") })
    }).then(r => r.json());
    const uid = lookup.users && lookup.users[0] && lookup.users[0].localId;
    if (!uid) return reply({ ok: false, message: "Please log in again." }, 401);
    const dbToken = await getAccessToken(env);
    const approved = await fetch(`${DB_URL}/admins/${uid}.json`, { headers: { Authorization: `Bearer ${dbToken}` } }).then(r => r.json());
    if (approved !== true) return reply({ ok: false, message: "Not allowed." }, 403);

    const boundary = "hs" + crypto.randomUUID().replace(/-/g, "");
    const subject = "Your Hamstore vehicle ID " + v.code;
    const mime = [
      `From: Hamstore <${env.GMAIL_SENDER || "me"}>`,
      `To: ${v.to}`,
      `Subject: =?UTF-8?B?${utf8b64(subject)}?=`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrap(plainText(v)),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrap(htmlBody(v)),
      `--${boundary}--`,
      ""
    ].join("\r\n");

    const sent = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${await gmailToken(env)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: b64url(mime) })
    });
    if (!sent.ok) return reply({ ok: false, message: "Gmail refused the message." }, 502);
    return reply({ ok: true, message: "Email sent to " + v.to });
  } catch (e) {
    return reply({ ok: false, message: "Could not send the email." }, 500);
  }
}

export async function onRequest() {
  return reply({ ok: false, message: "Method not allowed." }, 405);
}