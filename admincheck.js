import { supabase, must } from "./supabase.js";
import { requireAdmin } from "./guard.js";
import { toast, naira, esc, ago } from "./allui.js";

await requireAdmin("rep");

const $ = id => document.getElementById(id);
const REFRESH_MS = 20000;

function stat(label, value, kind) {
  return `<div class="ck-stat ${kind || ""}"><small>${esc(label)}</small><b>${esc(value)}</b></div>`;
}

async function load() {
  $("stats").innerHTML = stat("Loading", "...");
  const [pend, del, latest, accs, shop, old] = await Promise.all([
    supabase.from("deliveries").select("code", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("deliveries").select("code", { count: "exact", head: true }).eq("status", "delivered"),
    supabase.from("deliveries").select("code,name,phone,total,status,created_at").order("created_at", { ascending: false }).limit(12),
    supabase.from("payment_accounts").select("id,number"),
    supabase.from("settings").select("value").eq("key", "shop_open").maybeSingle(),
    supabase.from("orders").select("*", { count: "exact", head: true })
  ]);

  const accountOk = !accs.error && (accs.data || []).some(a => String(a.number || "").trim());
  const shopOpen = !shop.error && (!shop.data || shop.data.value !== "no");

  $("stats").innerHTML = [
    stat("Waiting for delivery", pend.error ? "error" : String(pend.count || 0), pend.count ? "" : ""),
    stat("Delivered", del.error ? "error" : String(del.count || 0)),
    stat("Payment account", accountOk ? "Ready" : "Missing", accountOk ? "ok" : "bad"),
    stat("Online buying", shopOpen ? "Open" : "Closed", shopOpen ? "ok" : "bad"),
    stat("Old checkout table", old.error ? "Not used" : String(old.count || 0))
  ].join("");

  if (latest.error) {
    $("latest").innerHTML = `<div class="ck-empty">${esc("Could not read orders. Run hamstore_orders_fix.sql and hamstore_admin_fix.sql in Supabase, then refresh.")}</div>`;
    return;
  }
  const rows = latest.data || [];
  $("latest").innerHTML = rows.length
    ? rows.map(r => `<div class="ck-row"><div><b>${esc(r.code)}</b><span>${esc(r.name || "")} · ${esc(r.phone || "")}</span><span>${esc(ago(Number(r.created_at) || 0))}</span></div><div style="text-align:right"><span class="ck-tag ${r.status === "delivered" ? "delivered" : ""}">${esc(r.status)}</span><span>${esc(naira(r.total))}</span></div></div>`).join("")
    : `<div class="ck-empty">No orders yet. Place a test order from the checkout page, then press Refresh.</div>`;
}

$("refresh").onclick = async () => {
  try { await load(); } catch (e) { toast("error", "Could not load", "Check your internet and try again."); }
};

await load();
setInterval(() => { load().catch(() => {}); }, REFRESH_MS);
