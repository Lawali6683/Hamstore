import { app } from "./firebase.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";
import { requireAdmin } from "./guard.js";
import { toast, confirmBox } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

const db = getDatabase(app);
await requireAdmin("shop");

const $ = id => document.getElementById(id);
let current = "yes";
let ready = false;

function paint(data) {
  current = data && data.open === "no" ? "no" : "yes";
  const on = current === "yes";
  $("card").classList.toggle("on", on);
  $("state").textContent = on ? "Online buying is ON" : "Online buying is OFF";
  $("desc").textContent = on ? "Customers can buy on the website now." : "The website shows prices only. Customers are sent to the nearest branch.";
  $("idv").textContent = "open: " + current;
  $("toggle").disabled = false;
  $("toggle").className = "btn full" + (on ? " red" : "");
  $("toggle").innerHTML = on ? '<i class="fa-solid fa-power-off"></i><span>Turn OFF online buying</span>' : '<i class="fa-solid fa-power-off"></i><span>Turn ON online buying</span>';
  $("upd").textContent = data && data.updatedAt ? "Last changed: " + new Date(data.updatedAt).toLocaleString("en-NG") : "Not changed yet. The default is open: yes.";
  ready = true;
}

onValue(ref(db, "settings/shop"), snap => paint(snap.val()), () => {
  toast("error", "Could not read the setting", "Check your internet and try again.");
});

$("toggle").onclick = async () => {
  if (!ready) return;
  const next = current === "yes" ? "no" : "yes";
  const ok = await confirmBox({
    title: next === "no" ? "Turn off online buying?" : "Turn on online buying?",
    text: next === "no" ? "Customers will see prices but cannot buy. They will be shown the nearest branch." : "Customers will be able to buy and pay on the website.",
    okText: next === "no" ? "Turn off" : "Turn on",
    danger: next === "no"
  });
  if (!ok) return;
  showLoading("Saving...");
  try {
    await set(ref(db, "settings/shop"), { open: next, updatedAt: Date.now() });
    toast("success", "Saved", "open: " + next);
  } catch (e) {
    toast("error", "Could not save", "You may not have permission, or the connection failed.");
  } finally {
    hideLoading();
  }
};
