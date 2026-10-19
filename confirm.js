import { toast } from "./allui.js";
import { prettyCode, codeKey } from "./ui2.js";
import { showLoading, hideLoading } from "./loading.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const steps = [...document.querySelectorAll(".step")];
let vehicle = null;

if (params.get("c")) $("mCode").value = prettyCode(codeKey(params.get("c")));
if (params.get("k")) $("mKey").value = params.get("k");
if (!params.get("c") || !params.get("k")) $("manual").hidden = false;

function finish(n) {
  steps[n - 1].classList.add("done");
  steps[n - 1].querySelector("button").hidden = true;
  if (steps[n]) steps[n].classList.remove("lock");
}

steps[0].querySelector("button").onclick = async () => {
  const code = $("mCode").value.trim();
  const key = $("mKey").value.trim();
  if (!code || !key) return toast("error", "Missing details", "Enter your ID and key.");
  showLoading("Checking your ID...");
  try {
    const res = await fetch("/api/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, key })
    });
    const data = await res.json();
    if (!data.ok) return toast("error", "Could not confirm", data.message || "Check your ID and link.");
    vehicle = { id: data.id, key, name: data.name, plate: data.plate, code: prettyCode(codeKey(code)) };
    $("vTitle").textContent = `${data.name} (${data.plate})`;
    $("vCode").textContent = vehicle.code;
    $("vbox").hidden = false;
    $("manual").hidden = true;
    toast("success", "ID confirmed", "Continue with the next step.");
    finish(1);
  } catch (e) {
    toast("error", "Network error", "Check your internet and try again.");
  } finally {
    hideLoading();
  }
};

steps[1].querySelector("button").onclick = () => {
  if (!navigator.geolocation) return toast("error", "Not supported", "This phone cannot share its location.");
  showLoading("Waiting for permission...");
  navigator.geolocation.getCurrentPosition(() => {
    hideLoading();
    toast("success", "Location allowed", "GPS is working.");
    finish(2);
  }, err => {
    hideLoading();
    toast("error", err.code === 1 ? "Location blocked" : "No GPS signal", err.code === 1 ? "Allow location for this site in your browser settings." : "Move to an open area and try again.");
  }, { enableHighAccuracy: true, timeout: 20000 });
};

steps[2].querySelector("button").onclick = async () => {
  try {
    if ("wakeLock" in navigator) {
      const lock = await navigator.wakeLock.request("screen");
      lock.release();
      toast("success", "Screen will stay on", "Keep the page open while driving.");
    } else {
      toast("success", "Almost done", "Turn off screen timeout in your phone settings while driving.");
    }
  } catch (e) {
    toast("success", "Almost done", "Turn off screen timeout in your phone settings while driving.");
  }
  finish(3);
};

steps[3].querySelector("button").onclick = () => {
  try {
    localStorage.setItem("hs_vid", vehicle.id);
    localStorage.setItem("hs_vkey", vehicle.key);
    localStorage.setItem("hs_vname", `${vehicle.name} (${vehicle.plate})`);
    localStorage.setItem("hs_vcode", vehicle.code);
    localStorage.setItem("hs_confirmed", "1");
  } catch (e) {
    return toast("error", "Cannot save", "Turn off private browsing and try again.");
  }
  location.href = "tracker.html";
};