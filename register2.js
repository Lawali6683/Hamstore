import { app } from "./firebase.js";
import { getAuth, signInWithEmailAndPassword, signOut, sendEmailVerification, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { toast } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

const NEXT_PAGE = "admin.html";

const auth = getAuth(app);
const $ = id => document.getElementById(id);
const sw = $("switch");

function setTab(tab) {
  if (!sw) return;
  sw.dataset.tab = tab;
  sw.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  const loginForm = $("loginForm");
  const regForm = $("regForm");
  if (loginForm) loginForm.classList.toggle("on", tab === "login");
  if (regForm) regForm.classList.toggle("on", tab === "register");
}

if (sw) {
  sw.querySelectorAll("button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
}

const errors = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/invalid-email": "Enter a valid email.",
  "auth/user-disabled": "This account is disabled.",
  "auth/too-many-requests": "Too many attempts. Try again later.",
  "auth/network-request-failed": "No internet connection."
};

const loginForm = $("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async e => {
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
}

const regForm = $("regForm");
if (regForm) {
  regForm.addEventListener("submit", async e => {
    e.preventDefault();
    const name = $("rName").value.trim();
    const email = $("rEmail").value.trim();
    const password = $("rPass").value;
    const rPass2 = $("rPass2");
    if (name.length < 2) return toast("error", "Name needed", "Enter your full name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast("error", "Invalid email", "Check your email address.");
    if (password.length < 8) return toast("error", "Weak password", "Use at least 8 characters.");
    if (rPass2 && password !== rPass2.value) return toast("error", "Passwords differ", "Both passwords must match.");
    showLoading("Creating your account...");
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
      });
      const data = await res.json();
      if (data.ok) {
        let note = "Account created. Log in to continue.";
        try {
          const cred = await signInWithEmailAndPassword(auth, email, password);
          await sendEmailVerification(cred.user);
          await signOut(auth);
          note = "Account created. We sent a link to your email. Open it, then log in.";
        } catch (err) {
          console.warn("verification email not sent:", err.code);
        }
        toast("success", "Account created", note, 9000);
        regForm.reset();
        const lEmail = $("lEmail");
        if (lEmail) lEmail.value = email;
        setTab("login");
      } else {
        if (data.detail) console.warn("register detail:", data.detail);
        toast("error", "Could not register", data.message || "Try again.");
      }
    } catch (err) {
      toast("error", "Network error", "Check your internet and try again.");
    } finally {
      hideLoading();
    }
  });
}

const forgotBtn = $("forgot");
if (forgotBtn) {
  forgotBtn.addEventListener("click", async () => {
    const lEmail = $("lEmail");
    const email = lEmail ? lEmail.value.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast("error", "Enter your email", "Type your email above, then press Forgot password.");
    try {
      await sendPasswordResetEmail(auth, email);
      toast("success", "Check your email", "We sent a link to reset your password.", 7000);
    } catch (err) {
      toast("error", "Could not send", errors[err.code] || "Try again later.");
    }
  });
}
