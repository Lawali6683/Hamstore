import { app } from "./firebase.js";
import { getAuth, onAuthStateChanged, signOut, sendEmailVerification } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";
import { adminHeader, toast } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

const auth = getAuth(app);
const db = getDatabase(app);

const TEXT = {
  unverified: ["Verify your email first", "We need to confirm that this email address is yours. Press the first button, open the link we send to your inbox, then press the second button."],
  notallowed: ["This account is not allowed", "Only approved Hamstore staff can manage this site."],
  error: ["Could not check your access", "Check your internet and try again."]
};

async function check(user) {
  try { await user.reload(); } catch (e) {}
  try {
    const token = await user.getIdToken(true);
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token })
    });
    const json = await res.json();
    if (json.ok) return { ok: true };
    if (json.code === "unverified" || json.code === "notallowed") return { ok: false, code: json.code };
    console.warn("session check failed:", json.code);
  } catch (e) {
    console.warn("session check unreachable");
  }
  try {
    const snap = await get(ref(db, "admins/" + user.uid));
    return snap.val() === true ? { ok: true } : { ok: false, code: "error" };
  } catch (e) {
    return { ok: false, code: "error" };
  }
}

function denied(user, code) {
  const [title, text] = TEXT[code] || TEXT.error;
  document.body.classList.remove("locked");
  const main = document.querySelector("main");
  main.innerHTML = `<section class="panel box center" style="margin:40px auto">
    <h2></h2><p class="sub"></p>
    <div style="display:grid;gap:10px">
      ${code === "unverified" ? '<button class="btn" id="gSend" type="button"><i class="fa-solid fa-envelope-circle-check"></i>Send verification email</button><button class="ghost" id="gDone" type="button">I have verified my email</button>' : ""}
      ${code === "error" ? '<button class="btn" id="gRetry" type="button"><i class="fa-solid fa-rotate"></i>Try again</button>' : ""}
      <button class="ghost" id="gOut" type="button">Log out</button>
    </div></section>`;
  main.querySelector("h2").textContent = title;
  main.querySelector("p").textContent = text;
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on("gSend", async () => {
    try { await sendEmailVerification(user); toast("success", "Email sent", "Open the link in your inbox, then come back."); }
    catch (e) { toast("error", "Could not send", e.code === "auth/too-many-requests" ? "Too many tries. Wait a few minutes." : "Try again later."); }
  });
  on("gDone", () => location.reload());
  on("gRetry", () => location.reload());
  on("gOut", async () => {
    await signOut(auth);
    sessionStorage.removeItem("hs_gate");
    location.replace("admin.html");
  });
}

export function requireAdmin(active) {
  adminHeader(active);
  document.body.classList.add("locked");
  document.getElementById("hsOut").onclick = async () => {
    await signOut(auth);
    sessionStorage.removeItem("hs_gate");
    location.replace("admin.html");
  };
  if (sessionStorage.getItem("hs_gate") !== "1") {
    location.replace("admin.html");
    return new Promise(() => {});
  }
  showLoading("Checking access...");
  return new Promise(resolve => {
    let settled = false;
    onAuthStateChanged(auth, async user => {
      if (settled) return;
      if (!user) return location.replace("gate.html");
      settled = true;
      const result = await check(user);
      hideLoading();
      if (result.ok) {
        document.body.classList.remove("locked");
        resolve(user);
      } else {
        denied(user, result.code);
      }
    });
  });
}
