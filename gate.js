import { supabase, isAdmin } from "./supabase.js";
import { toast } from "./allui.js";
import { bindCode } from "./ui2.js";
import { showLoading, hideLoading } from "./loading.js";

const NEXT_PAGE = "admin.html";

const $ = id => document.getElementById(id);

async function openLogin() {
  sessionStorage.setItem("hs_gate", "1");
  $("codeBox").hidden = true;
  const { data } = await supabase.auth.getSession();
  if (data.session && (await isAdmin())) return location.replace(NEXT_PAGE);
  $("loginBox").hidden = false;
  $("email").focus();
}

bindCode($("code"), openLogin);
if (sessionStorage.getItem("hs_gate") === "1") openLogin();

const errors = {
  invalid_credentials: "Wrong email or password.",
  email_not_confirmed: "Confirm your email first. Check your inbox, then log in.",
  validation_failed: "Enter a valid email.",
  user_banned: "This account is disabled.",
  over_request_rate_limit: "Too many attempts. Try again later.",
  over_email_send_rate_limit: "Too many emails sent. Try again later."
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

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;
  if (!email || !password) return toast("error", "Missing details", "Enter your email and password.");
  showLoading("Signing you in...");
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!(await isAdmin())) {
      await supabase.auth.signOut();
      return toast("error", "No access", "This account is not allowed to open the dashboard.");
    }
    toast("success", "Welcome back", "Opening your dashboard.");
    setTimeout(() => location.replace(NEXT_PAGE), 500);
  } catch (err) {
    toast("error", "Login failed", errText(err, "Something went wrong. Try again."));
  } finally {
    hideLoading();
  }
});

$("forgot").addEventListener("click", async () => {
  const email = $("email").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast("error", "Enter your email", "Type your email above, then press Forgot password.");
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) throw error;
    toast("success", "Check your email", "We sent a link to reset your password.", 7000);
  } catch (err) {
    toast("error", "Could not send", errText(err, "Try again later."));
  }
});

supabase.auth.onAuthStateChange(async event => {
  if (event !== "PASSWORD_RECOVERY") return;
  const pw = window.prompt("Enter your new password (at least 8 characters):");
  if (!pw) return;
  if (pw.length < 8) return toast("error", "Weak password", "Use at least 8 characters.");
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return toast("error", "Could not change password", errText(error, "Try again."));
  toast("success", "Password changed", "You can use your new password now.", 7000);
  history.replaceState(null, "", location.pathname);
});
