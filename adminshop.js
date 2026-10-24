import { supabase, must } from "./supabase.js";
import { requireAdmin } from "./guard.js";
import { toast, confirmBox } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

await requireAdmin("shop");

const $ = id => document.getElementById(id);
let current = "yes";
let ready = false;

function paint(open, updatedAt) {
  current = open === "no" ? "no" : "yes";
  const on = current === "yes";
  $("card").classList.toggle("on", on);
  $("state").textContent = on ? "Online buying is ON" : "Online buying is OFF";
  $("desc").textContent = on ? "Customers can buy on the website now." : "The website shows prices only. Customers are sent to the nearest branch.";
  $("idv").textContent = "open: " + current;
  $("toggle").disabled = false;
  $("toggle").className = "btn full" + (on ? " red" : "");
  $("toggle").innerHTML = on ? '<i class="fa-solid fa-power-off"></i><span>Turn OFF online buying</span>' : '<i class="fa-solid fa-power-off"></i><span>Turn ON online buying</span>';
  $("upd").textContent = updatedAt ? "Last changed: " + new Date(Number(updatedAt)).toLocaleString("en-NG") : "Not changed yet. The default is open: yes.";
  ready = true;
}

async function read() {
  const rows = must(await supabase.from("settings").select("key,value").in("key", ["shop_open", "shop_updated_at"])) || [];
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  paint(map.shop_open, map.shop_updated_at);
}

try {
  await read();
} catch (e) {
  toast("error", "Could not read the setting", "Check your internet and try again.");
}

supabase
  .channel("shop-admin")
  .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, () => { read().catch(() => {}); })
  .subscribe();

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
    const rows = must(await supabase.from("settings").upsert([
      { key: "shop_open", value: next },
      { key: "shop_updated_at", value: String(Date.now()) }
    ], { onConflict: "key" }).select("key"));
    if (!rows || rows.length < 2) throw new Error("denied");
    await read();
    toast("success", "Saved", "open: " + next);
  } catch (e) {
    toast("error", "Could not save", "You may not have permission, or the connection failed.");
  } finally {
    hideLoading();
  }
};
