import { app } from "./firebase.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { toast } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

const NEXT_PAGE = "adminpost.html";

const auth = getAuth(app);
const $ = id => document.getElementById(id);
const sw = $("switch");

function setTab(tab) {
  sw.dataset.tab = tab;
  sw.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  $("loginForm").classList.toggle("on", tab === "login");
  $("regForm").classList.toggle("on", tab === "register");
}
sw.querySelectorAll("button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));

const errors = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/invalid-email": "Enter a valid email.",
  "auth/user-disabled": "This account is disabled.",
  "auth/too-many-requests": "Too many attempts. Try again later.",
  "auth/network-request-failed": "No internet connection."
};

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("lEmail").value.trim();
  const password = $("lPass").value;
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

$("regForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("rName").value.trim();
  const email = $("rEmail").value.trim();
  const password = $("rPass").value;
  if (name.length < 2) return toast("error", "Name needed", "Enter your full name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast("error", "Invalid email", "Check your email address.");
  if (password.length < 8) return toast("error", "Weak password", "Use at least 8 characters.");
  if (password !== $("rPass2").value) return toast("error", "Passwords differ", "Both passwords must match.");
  showLoading("Creating your account...");
  try {
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (data.ok) {
      toast("success", "Account created", data.message, 7000);
      $("regForm").reset();
      $("lEmail").value = email;
      setTab("login");
    } else {
      toast("error", "Could not register", data.message);
    }
  } catch (err) {
    toast("error", "Network error", "Check your internet and try again.");
  } finally {
    hideLoading();
  }
});