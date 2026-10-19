import { app } from "./firebase.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { toast } from "./allui.js";
import { bindCode } from "./ui2.js";
import { showLoading, hideLoading } from "./loading.js";

const NEXT_PAGE = "admin.html";

const auth = getAuth(app);
const $ = id => document.getElementById(id);

async function openLogin() {
  sessionStorage.setItem("hs_gate", "1");
  $("codeBox").hidden = true;
  await auth.authStateReady();
  if (auth.currentUser) return location.replace(NEXT_PAGE);
  $("loginBox").hidden = false;
  $("email").focus();
}

bindCode($("code"), openLogin);
if (sessionStorage.getItem("hs_gate") === "1") openLogin();

const errors = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/invalid-email": "Enter a valid email.",
  "auth/user-disabled": "This account is disabled.",
  "auth/too-many-requests": "Too many attempts. Try again later.",
  "auth/network-request-failed": "No internet connection."
};

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) return toast("error", "Missing details", "Enter your email and password.");
  showLoading("Signing you in...");
  try {
    await signInWithEmailAndPassword(auth, email, password);
    toast("success", "Welcome back", "Opening your dashboard.");
    setTimeout(() => location.replace(NEXT_PAGE), 500);
  } catch (err) {
    toast("error", "Login failed", errors[err.code] || "Something went wrong. Try again.");
  } finally {
    hideLoading();
  }
});