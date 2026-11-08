import { supabase } from "./supabase.js";
import { toast } from "./allui.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
const pick = (...names) => {
  for (const n of names) {
    const v = params.get(n) || hash.get(n);
    if (v) return v;
  }
  return "";
};

let code = pick("c", "code", "id");
let key = pick("k", "key");
let vehicle = null;
let busy = false;
const done = { 1: false, 2: false, 3: false, 4: false };
const steps = [...document.querySelectorAll(".step")];

steps.forEach(el => {
  const btn = el.querySelector("button");
  btn.dataset.label = btn.textContent.trim();
});

function paint() {
  steps.forEach(el => {
    const n = Number(el.dataset.step);
    const btn = el.querySelector("button");
    const locked = n > 1 && !done[n - 1];
    el.classList.toggle("done", done[n]);
    el.classList.toggle("lock", locked);
    btn.disabled = done[n] || locked || busy;
    btn.textContent = done[n] ? "Done" : btn.dataset.label;
  });
}

function showManual() {
  $("manual").hidden = false;
}

async function doVerify() {
  if (!code && $("mCode").value) code = $("mCode").value.trim();
  if (!key && $("mKey").value) key = $("mKey").value.trim();
  if (!code || !key) {
    showManual();
    toast("error", "Open the link again", "The link from your message is incomplete.");
    return false;
  }
  busy = true;
  paint();
  try {
    const { data, error } = await supabase.rpc("confirm_vehicle_lookup", { p_code: code, p_key: key });
    if (error) throw error;
    if (!data || !data.ok) {
      showManual();
      const msg = data && data.code === "wait" ? "Too many attempts. Wait 10 minutes." : "This link is not valid. Ask the office to send it again.";
      toast("error", "Vehicle not found", msg);
      return false;
    }
    code = data.code;
    vehicle = data;
    $("vTitle").textContent = data.name || data.code;
    $("vCode").textContent = data.code + (data.plate ? " · " + data.plate : "");
    $("vbox").hidden = false;
    $("manual").hidden = true;
    done[1] = true;
    return true;
  } catch (e) {
    toast("error", "Could not check", "Check your internet and try again.");
    return false;
  } finally {
    busy = false;
    paint();
  }
}

function askLocation() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(false);
    navigator.geolocation.getCurrentPosition(() => res(true), () => res(false), { enableHighAccuracy: true, timeout: 15000 });
  });
}

async function doLocation() {
  const ok = await askLocation();
  done[2] = ok;
  if (!ok) toast("error", "Location blocked", "Allow location for this site in the browser settings, then press Allow location again.");
  paint();
  return ok;
}

async function doScreen() {
  try {
    if ("wakeLock" in navigator) await navigator.wakeLock.request("screen");
  } catch (e) {}
  done[3] = true;
  paint();
  return true;
}

async function doCommit() {
  busy = true;
  paint();
  try {
    const { data, error } = await supabase.rpc("confirm_vehicle_commit", { p_code: code, p_key: key });
    if (error) throw error;
    if (!data || !data.ok) throw new Error("denied");
    try {
      localStorage.setItem("hs_vid", code);
      localStorage.setItem("hs_vkey", key);
      localStorage.setItem("hs_vname", vehicle.name || code);
      localStorage.setItem("hs_vcode", vehicle.plate || "");
      localStorage.setItem("hs_confirmed", "1");
    } catch (e) {}
    done[4] = true;
    toast("success", "Confirmed", "Tracking starts now.");
    setTimeout(() => { location.href = "tracker.html"; }, 900);
    return true;
  } catch (e) {
    toast("error", "Could not confirm", "Check your internet and try again.");
    return false;
  } finally {
    busy = false;
    paint();
  }
}

async function autoRun() {
  if (!(await doVerify())) return;
  if (!(await doLocation())) return;
  await doScreen();
  await doCommit();
}

steps.forEach(el => {
  const n = Number(el.dataset.step);
  el.querySelector("button").addEventListener("click", () => {
    if (n === 1) return doVerify();
    if (n === 2) return doLocation();
    if (n === 3) return doScreen();
    if (n === 4) return doCommit();
  });
});

if (code && key) {
  $("manual").hidden = true;
  paint();
  autoRun();
} else {
  showManual();
  paint();
}
