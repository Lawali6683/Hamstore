import { supabase } from "./supabase.js";
import { toast } from "./allui.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
const read = k => params.get(k) || hash.get(k) || "";

let code = read("code") || read("id") || "";
let key = read("key") || read("k") || "";
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

async function verify() {
  const c = ($("mCode").value || code).trim().toUpperCase();
  const k = ($("mKey").value || key).trim();
  if (!c || !k) {
    $("manual").hidden = false;
    return toast("error", "Enter your ID and key", "Use the link we sent you.");
  }
  busy = true;
  paint();
  try {
    const { data, error } = await supabase.rpc("confirm_vehicle_lookup", { p_code: c, p_key: k });
    if (error) throw error;
    if (!data || !data.ok) {
      $("manual").hidden = false;
      const msg = data && data.code === "wait" ? "Too many attempts. Wait 10 minutes." : "Check the ID and key in your link.";
      return toast("error", "ID not found", msg);
    }
    code = data.code;
    key = k;
    vehicle = data;
    $("vTitle").textContent = data.name || data.code;
    $("vCode").textContent = data.code + (data.plate ? " · " + data.plate : "");
    $("vbox").hidden = false;
    done[1] = true;
  } catch (e) {
    toast("error", "Could not check", "Check your internet and try again.");
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

async function keepScreen() {
  try {
    if ("wakeLock" in navigator) await navigator.wakeLock.request("screen");
  } catch (e) {}
  return true;
}

async function commit() {
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
    toast("success", "Confirmed", "Tracking will start now.");
    setTimeout(() => { location.href = "tracker.html"; }, 900);
  } catch (e) {
    toast("error", "Could not confirm", "Check the ID and try again.");
  } finally {
    busy = false;
    paint();
  }
}

steps.forEach(el => {
  const n = Number(el.dataset.step);
  el.querySelector("button").addEventListener("click", async () => {
    if (n === 1) return verify();
    if (n === 2) {
      const ok = await askLocation();
      if (!ok) return toast("error", "Location blocked", "Allow location for this site in the browser settings.");
      done[2] = true;
      return paint();
    }
    if (n === 3) {
      done[3] = await keepScreen();
      return paint();
    }
    if (n === 4) return commit();
  });
});

if (code && key) {
  $("manual").hidden = true;
  verify();
} else {
  $("manual").hidden = false;
}
paint();
