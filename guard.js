import { app } from "./firebase.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";
import { adminHeader, toast, esc } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

const auth = getAuth(app);
const db = getDatabase(app);

function denied(user) {
  document.body.classList.remove("locked");
  document.querySelector("main").innerHTML = `<section class="panel box center" style="margin:40px auto">
    <h2>Access not approved yet</h2>
    <p class="sub">You are logged in, but this account cannot manage Hamstore. Send this ID to the owner to get approved.</p>
    <div class="keybox">${esc(user.uid)}</div>
    <button class="btn" id="copyId" type="button"><i class="fa-regular fa-copy"></i>Copy ID</button></section>`;
  document.getElementById("copyId").onclick = async () => {
    try { await navigator.clipboard.writeText(user.uid); toast("success", "Copied", "The ID is on your clipboard."); }
    catch (e) { toast("error", "Copy failed", "Select the ID and copy it by hand."); }
  };
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
      try {
        const snap = await get(ref(db, "admins/" + user.uid));
        hideLoading();
        if (snap.val() === true) {
          document.body.classList.remove("locked");
          resolve(user);
        } else {
          denied(user);
        }
      } catch (e) {
        hideLoading();
        denied(user);
      }
    });
  });
}