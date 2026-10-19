import { toast, km } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

const MOVING_EVERY = 15000;
const STOPPED_EVERY = 60000;

const $ = id => document.getElementById(id);

let watchId = null;
let wakeLock = null;
let running = false;
let waitingFix = false;
let lastSent = 0;
let lastPoint = null;
let sent = 0;
let fails = 0;
let battery = null;
let creds = { id: "", key: "" };

const read = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const confirmed = read("hs_confirmed") === "1" && read("hs_vid") && read("hs_vkey");

if (navigator.getBattery) {
  navigator.getBattery().then(b => {
    battery = Math.round(b.level * 100);
    b.addEventListener("levelchange", () => { battery = Math.round(b.level * 100); });
  }).catch(() => {});
}

if (confirmed) {
  $("manual").hidden = true;
  $("veh").hidden = false;
  $("vName").textContent = read("hs_vname") || read("hs_vid");
  $("vCode").textContent = read("hs_vcode");
  $("forget").hidden = false;
  $("sub").textContent = "This phone is confirmed. Tracking starts on its own.";
} else {
  $("vId").value = read("hs_vid");
  $("vKey").value = read("hs_vkey");
}

function paint(speed, accuracy) {
  $("live").classList.toggle("on", running);
  $("live").querySelector("span").textContent = running ? "Tracking is on" : "Not tracking";
  $("toggle").classList.toggle("red", running);
  $("toggle").innerHTML = running
    ? '<i class="fa-solid fa-stop"></i><span>Stop tracking</span>'
    : '<i class="fa-solid fa-play"></i><span>Start tracking</span>';
  if (typeof speed === "number") $("sSpeed").textContent = Math.round(speed) + " km/h";
  if (typeof accuracy === "number") $("sAcc").textContent = Math.round(accuracy) + " m";
  $("sCount").textContent = sent;
  $("sLast").textContent = lastSent ? new Date(lastSent).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "-";
}

function speedOf(pos) {
  const c = pos.coords;
  if (typeof c.speed === "number" && !Number.isNaN(c.speed)) return c.speed * 3.6;
  if (!lastPoint) return 0;
  const dist = km(lastPoint, { lat: c.latitude, lng: c.longitude });
  const hours = (pos.timestamp - lastPoint.t) / 3600000;
  if (dist < 0.02 || hours <= 0) return 0;
  return Math.min(200, dist / hours);
}

async function send(lat, lng, speed, heading) {
  const body = { id: creds.id, key: creds.key, lat, lng, speed };
  if (typeof heading === "number" && !Number.isNaN(heading)) body.head = heading;
  if (battery !== null) body.bat = battery;
  const res = await fetch("/api/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true
  });
  if (res.status === 401) return "denied";
  if (!res.ok) throw new Error("send");
  return "ok";
}

async function onPosition(pos) {
  if (waitingFix) { waitingFix = false; hideLoading(); }
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const speed = speedOf(pos);
  lastPoint = { lat, lng, t: pos.timestamp };
  paint(speed, pos.coords.accuracy);

  const wait = speed >= 3 ? MOVING_EVERY : STOPPED_EVERY;
  if (Date.now() - lastSent < wait) return;
  lastSent = Date.now();

  try {
    const result = await send(lat, lng, speed, pos.coords.heading);
    if (result === "denied") {
      stop();
      return toast("error", "Vehicle not recognised", "Confirm this vehicle again with the link we sent.");
    }
    sent++;
    fails = 0;
    paint(speed, pos.coords.accuracy);
  } catch (e) {
    fails++;
    if (fails === 3) toast("error", "No connection", "Still trying. Keep the page open.");
  }
}

function onError(err) {
  if (waitingFix) { waitingFix = false; hideLoading(); }
  if (err.code === 1) {
    stop();
    toast("error", "Location blocked", "Allow location for this site in your browser settings.");
  } else if (err.code === 2) {
    toast("error", "No GPS signal", "Move to an open area. We will keep trying.");
  }
}

async function keepAwake() {
  try {
    if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen");
  } catch (e) {}
}

document.addEventListener("visibilitychange", () => {
  if (running && document.visibilityState === "visible") keepAwake();
});

window.addEventListener("beforeunload", e => {
  if (running) { e.preventDefault(); e.returnValue = ""; }
});

function start() {
  const id = confirmed ? read("hs_vid") : $("vId").value.trim().toUpperCase();
  const key = confirmed ? read("hs_vkey") : $("vKey").value.trim();
  if (!/^VEH\d{4,}$/.test(id)) return toast("error", "Vehicle ID", "Enter the ID like VEH0001.");
  if (key.length < 8) return toast("error", "Vehicle key", "Enter the vehicle key.");
  if (!navigator.geolocation) return toast("error", "Not supported", "This phone cannot share its location.");
  creds = { id, key };
  if (!confirmed) { try { localStorage.setItem("hs_vid", id); localStorage.setItem("hs_vkey", key); } catch (e) {} }
  running = true;
  waitingFix = true;
  lastSent = 0;
  lastPoint = null;
  sent = 0;
  fails = 0;
  showLoading("Getting GPS signal...");
  watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  keepAwake();
  paint();
}

function stop() {
  running = false;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  if (waitingFix) { waitingFix = false; hideLoading(); }
  paint();
}

$("form").addEventListener("submit", e => {
  e.preventDefault();
  if (running) stop();
  else start();
});

$("forget").onclick = () => {
  stop();
  ["hs_vid", "hs_vkey", "hs_vname", "hs_vcode", "hs_confirmed"].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  location.reload();
};

if (confirmed) start();