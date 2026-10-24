import { supabase } from "./supabase.js";
import { toast } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

const NEXT_PAGE = "admin.html";

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
  invalid_credentials: "Wrong email or password.",
  email_not_confirmed: "Confirm your email first. Check your inbox, then log in.",
  validation_failed: "Enter a valid email.",
  user_banned: "This account is disabled.",
  over_request_rate_limit: "Too many attempts. Try again later.",
  over_email_send_rate_limit: "Too many emails sent. Try again later.",
  weak_password: "Password is too weak."
};

const errText = (err, fallback) => {
  if (!err) return fallback;
  if (errors[err.code]) return errors[err.code];
  const msg = String(err.message || "").toLowerCase();
  if (msg.includes("invalid login")) return errors.invalid_credentials;
  if (msg.includes("not confirmed")) return errors.email_not_confirmed;
  if (msg.includes("failed to fetch") || msg.includes("network")) return "No internet connection.";
  return fallback;
};


supabase.auth.getSession().then(({ data }) => {
  if (data.session && $("loginForm") && !location.hash.includes("type=recovery")) {
    
    // location.replace(NEXT_PAGE);
  }
});

const loginForm = $("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("lEmail").value.trim().toLowerCase();
    const password = $("lPass").value;
    if (!email || !password) return toast("error", "Missing details", "Enter your email and password.");
    showLoading("Signing you in...");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast("success", "Welcome back", "Opening your dashboard.");
      setTimeout(() => location.replace(NEXT_PAGE), 500);
    } catch (err) {
      toast("error", "Login failed", errText(err, "Something went wrong. Try again."));
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
    const email = $("rEmail").value.trim().toLowerCase();
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
        
        const note = data.needsConfirm
          ? "Account created. We sent a link to your email. Open it, then log in."
          : "Account created. Log in to continue.";
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
    const email = lEmail ? lEmail.value.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast("error", "Enter your email", "Type your email above, then press Forgot password.");
    try {
      const redirectTo = location.origin + location.pathname;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      toast("success", "Check your email", "We sent a link to reset your password.", 7000);
    } catch (err) {
      toast("error", "Could not send", errText(err, "Try again later."));
    }
  });
}


supabase.auth.onAuthStateChange(async (event) => {
  if (event !== "PASSWORD_RECOVERY") return;
  const pw = window.prompt("Enter your new password (at least 8 characters):");
  if (!pw) return;
  if (pw.length < 8) return toast("error", "Weak password", "Use at least 8 characters.");
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return toast("error", "Could not change password", errText(error, "Try again."));
  toast("success", "Password changed", "You can use your new password now.", 7000);
  history.replaceState(null, "", location.pathname);
});
