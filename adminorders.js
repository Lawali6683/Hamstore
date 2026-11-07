import { supabase, must } from "./supabase.js";
import { toast, confirmBox, openModal, telHref, esc, ago } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";
import { openRouteMap } from "./hsmap.js";
import { downloadSlip } from "./slip.js";

const PAGE = 20;
const DAY = 86400000;

const naira = n => "₦" + Math.round(Number(n) || 0).toLocaleString("en-US");
const safeUrl = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
const waNum = p => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("234")) return d;
  if (d.startsWith("0")) return "234" + d.slice(1);
  return d;
};
const hasPos = r => typeof r.lat === "number" && typeof r.lng === "number";
const isOn = d => !!d.online && Date.now() - Number(d.last_seen || 0) < 90000;
const norm = r => ({ ...r, createdAt: Number(r.created_at) || 0, deliveredAt: Number(r.delivered_at) || 0, list: Array.isArray(r.items) ? r.items : [] });

export async function mount(root, ctx = {}) {
  root.innerHTML = `
    <div class="ar-stats">
      <div class="s new"><i class="fa-solid fa-truck-fast"></i><b data-s="pend">0</b><small>Waiting for delivery</small></div>
      <div class="s"><i class="fa-solid fa-circle-check"></i><b data-s="today">0</b><small>Delivered today</small></div>
      <div class="s"><i class="fa-solid fa-naira-sign"></i><b data-s="value">0</b><small>Pending value</small></div>
      <div class="s"><i class="fa-solid fa-box-archive"></i><b data-s="all">0</b><small>Orders loaded</small></div>
    </div>
    <label class="ar-search"><i class="fa-solid fa-magnifying-glass"></i><input data-q type="search" autocomplete="off" placeholder="Search code, customer, phone, address or driver"></label>
    <div class="chips" data-filters>
      <button class="chip on" data-f="pending">Pending <b>0</b></button>
      <button class="chip" data-f="delivered">Delivered <b>0</b></button>
      <button class="chip" data-f="all">All <b>0</b></button>
    </div>
    <section class="ar-old">
      <h4><i class="fa-solid fa-broom"></i>Clean up old delivered orders</h4>
      <p>Delivered orders are kept so you can review them. Delete the old ones when you want to free space.</p>
      <div class="ar-old-b">
        <button type="button" data-purge="7">Older than 1 week <b data-pc="7">0</b></button>
        <button type="button" data-purge="30">Older than 1 month <b data-pc="30">0</b></button>
        <button type="button" data-purge="365">Older than 1 year <b data-pc="365">0</b></button>
      </div>
    </section>
    <div class="rg" data-list></div>
    <div class="empty" data-empty hidden><i class="fa-solid fa-truck" style="font-size:28px"></i><p>No orders here yet.</p></div>
    <button class="btn more" data-more type="button" hidden><i class="fa-solid fa-angles-down"></i>Load more</button>`;

  const q = s => root.querySelector(s);
  const rows = new Map();
  const dm = new Map();
  let drivers = [];
  let fetched = 0;
  let done = false;
  let busy = false;
  let filter = "pending";
  let term = "";

  const driverOf = id => drivers.find(d => d.id === id);
  const driverLink = d => `${location.origin}/driver.html?k=${encodeURIComponent(d.dkey)}`;

  async function loadDrivers() {
    try {
      drivers = must(await supabase.from("drivers").select("id,name,phone,dkey,status,online,last_seen").order("name", { ascending: true })) || [];
    } catch (e) {
      drivers = [];
    }
  }

  async function loadDispatches() {
    try {
      const list = must(await supabase.from("dispatches").select("dcode,delivery_code,driver_id,driver_name,status,created_at,opened_at").eq("status", "open").order("created_at", { ascending: false }).limit(500)) || [];
      dm.clear();
      list.forEach(x => { if (!dm.has(x.delivery_code)) dm.set(x.delivery_code, x); });
    } catch (e) {}
  }

  async function fetchPage() {
    const data = (must(await supabase.from("deliveries").select("*").order("created_at", { ascending: false }).range(fetched, fetched + PAGE - 1)) || []).map(norm);
    fetched += data.length;
    if (data.length < PAGE) done = true;
    return data;
  }

  function passes(r) {
    if (filter === "pending" && r.status !== "pending") return false;
    if (filter === "delivered" && r.status !== "delivered") return false;
    if (!term) return true;
    return [r.code, r.name, r.phone, r.driver, r.address].join(" ").toLowerCase().includes(term);
  }

  function assignHTML(r) {
    const x = dm.get(r.code);
    const options = drivers.filter(d => d.status === "active").map(d => `<option value="${esc(d.id)}">${isOn(d) ? "● " : "○ "}${esc(d.name)}</option>`).join("");
    if (x) {
      const dv = x.driver_id ? driverOf(x.driver_id) : null;
      return `<div class="ar-disp"><i class="fa-solid fa-user-check"></i><div><small>${x.driver_id ? "Assigned to" : "One-time code"}</small><b>${esc(x.driver_name || x.dcode)}</b><span>${x.opened_at ? "Driver opened it" : "Not opened yet"} · ${esc(x.dcode)}</span></div>${dv && dv.phone ? `<button class="ab wa" data-act="notify" type="button" aria-label="Notify driver"><i class="fa-brands fa-whatsapp"></i></button>` : ""}<button class="ab danger" data-act="unassign" type="button" aria-label="Cancel"><i class="fa-solid fa-ban"></i></button></div>`;
    }
    return `<div class="ar-assign"><select class="ar-sel" data-sel aria-label="Driver"><option value="">${options ? "Choose a driver" : "No driver registered yet"}</option>${options}</select><button class="ab ok" data-act="assign" type="button"><i class="fa-solid fa-user-check"></i>Assign</button></div>`;
  }

  function cardHTML(r) {
    const isDone = r.status === "delivered";
    const pos = hasPos(r);
    const when = new Date(r.createdAt).toLocaleString();
    const proof = safeUrl(r.proof_url);
    const lines = r.list.map(i => `<div class="ar-row"><i class="fa-solid fa-box"></i><span>${esc(i.name)} × ${esc(i.qty)}</span><b>${esc(naira(i.line || (Number(i.price) || 0) * (Number(i.qty) || 0)))}</b></div>`).join("");
    return `<article class="ar-card ${isDone ? "done" : "order"}" data-id="${esc(r.code)}">
      <header class="ar-h">
        <span class="av"><i class="fa-solid ${isDone ? "fa-check" : "fa-truck-fast"}"></i></span>
        <div class="who"><h4>${esc(r.name || "Customer")}</h4>${r.phone ? `<a class="ph" href="${telHref(r.phone)}"><i class="fa-solid fa-phone"></i>${esc(r.phone)}</a>` : ""}</div>
        <div class="tags"><span class="stt ${isDone ? "d" : "n"}">${isDone ? "Delivered" : "Pending"}</span></div>
      </header>
      <p class="when"><i class="fa-regular fa-clock"></i><time class="ago" data-ts="${r.createdAt}" title="${esc(when)}">${esc(ago(r.createdAt))}</time><span>${esc(when)}</span><b class="ref">${esc(r.code)}</b></p>
      <div class="ar-rows">${lines}</div>
      <div class="ar-sum"><span>Total paid</span><b>${esc(naira(r.total))}</b></div>
      ${r.address ? `<div class="ar-rows"><div class="ar-row"><i class="fa-solid fa-location-dot"></i><span>${esc(r.address)}</span><button class="cp" type="button" data-copy="${esc(r.address)}" aria-label="Copy"><i class="fa-regular fa-copy"></i></button></div></div>` : ""}
      ${proof ? `<a class="ar-proof" href="${esc(proof)}" target="_blank" rel="noopener"><img src="${esc(proof)}" alt="Payment proof" loading="lazy"><span><i class="fa-solid fa-receipt"></i>Payment proof</span></a>` : ""}
      ${isDone ? `<div class="ar-rows"><div class="ar-row"><i class="fa-solid fa-id-badge"></i><span>Driver: ${esc(r.driver || "-")}</span></div><div class="ar-row"><i class="fa-solid fa-check-double"></i><span>${esc(new Date(r.deliveredAt).toLocaleString())}</span></div>${r.note ? `<div class="ar-row"><i class="fa-solid fa-note-sticky"></i><span>${esc(r.note)}</span></div>` : ""}</div>` : assignHTML(r)}
      <div class="ar-acts">
        ${pos ? '<button class="ab route" data-act="map" type="button"><i class="fa-solid fa-route"></i>Map and route</button>' : ""}
        ${isDone && typeof r.delivered_lat === "number" ? '<button class="ab" data-act="where" type="button"><i class="fa-solid fa-location-dot"></i>Delivered here</button>' : ""}
        ${r.phone ? `<a class="ab call" href="${telHref(r.phone)}"><i class="fa-solid fa-phone"></i>Call</a><a class="ab wa" href="https://wa.me/${waNum(r.phone)}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i>WhatsApp</a>` : ""}
        <button class="ab" data-act="slip" type="button"><i class="fa-solid fa-file-pdf"></i>Slip PDF</button>
        <button class="ab" data-act="copycode" type="button"><i class="fa-regular fa-copy"></i>Code</button>
      </div>
      <div class="ar-danger"><button class="ab danger" data-act="del" type="button"><i class="fa-solid fa-trash"></i>Delete order</button></div></article>`;
  }

  function counts() {
    let p = 0, d = 0, today = 0, val = 0;
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    rows.forEach(r => {
      if (r.status === "delivered") { d++; if (r.deliveredAt >= day.getTime()) today++; }
      else { p++; val += Number(r.total) || 0; }
    });
    q('[data-s="pend"]').textContent = p;
    q('[data-s="today"]').textContent = today;
    q('[data-s="value"]').textContent = naira(val);
    q('[data-s="all"]').textContent = rows.size;
    q("[data-filters]").querySelectorAll(".chip").forEach(c => {
      const b = c.querySelector("b");
      b.textContent = c.dataset.f === "pending" ? p : c.dataset.f === "delivered" ? d : rows.size;
    });
    if (ctx.badge) ctx.badge("ord", p);
  }

  function emptyCheck() {
    q("[data-empty]").hidden = q("[data-list]").children.length > 0;
    q("[data-more]").hidden = done;
  }

  function render() {
    const list = [...rows.values()].filter(passes).sort((a, b) => b.createdAt - a.createdAt);
    q("[data-list]").innerHTML = list.map(cardHTML).join("");
    counts();
    emptyCheck();
  }

  const cardEl = code => q("[data-list]").querySelector(`[data-id="${CSS.escape(String(code))}"]`);

  function upsert(r, isNew) {
    const el = cardEl(r.code);
    if (!passes(r)) { if (el) el.remove(); }
    else if (el) el.outerHTML = cardHTML(r);
    else if (isNew) {
      q("[data-list]").insertAdjacentHTML("afterbegin", cardHTML(r));
      q("[data-list]").firstElementChild.classList.add("fresh");
    }
    counts();
    emptyCheck();
  }

  async function countOld(days) {
    try {
      const { count } = await supabase.from("deliveries").select("code", { count: "exact", head: true }).eq("status", "delivered").lt("delivered_at", Date.now() - days * DAY);
      return count || 0;
    } catch (e) {
      return 0;
    }
  }

  async function paintOld() {
    for (const d of [7, 30, 365]) q(`[data-pc="${d}"]`).textContent = await countOld(d);
  }

  async function loadMore() {
    if (busy || done) return;
    busy = true;
    q("[data-more]").disabled = true;
    try {
      const data = await fetchPage();
      data.forEach(r => rows.set(r.code, r));
      q("[data-list]").insertAdjacentHTML("beforeend", data.filter(passes).sort((a, b) => b.createdAt - a.createdAt).map(cardHTML).join(""));
      counts();
      emptyCheck();
    } catch (e) {
      toast("error", "Could not load orders", "Check your internet and try again.");
    } finally {
      busy = false;
      q("[data-more]").disabled = false;
    }
  }

  q("[data-more]").onclick = loadMore;
  new IntersectionObserver(en => { if (en[0].isIntersecting) loadMore(); }, { rootMargin: "500px" }).observe(q("[data-more]"));

  q("[data-filters]").querySelectorAll(".chip").forEach(c => c.onclick = () => {
    filter = c.dataset.f;
    q("[data-filters]").querySelectorAll(".chip").forEach(z => z.classList.toggle("on", z === c));
    render();
  });

  let searchT = 0;
  q("[data-q]").addEventListener("input", e => {
    clearTimeout(searchT);
    searchT = setTimeout(() => { term = e.target.value.trim().toLowerCase(); render(); }, 180);
  });

  q(".ar-old-b").addEventListener("click", async e => {
    const b = e.target.closest("[data-purge]");
    if (!b) return;
    const days = Number(b.dataset.purge);
    const label = days === 7 ? "1 week" : days === 30 ? "1 month" : "1 year";
    const n = await countOld(days);
    if (!n) return toast("error", "Nothing to delete", "No delivered order is older than " + label + ".");
    if (!(await confirmBox({ title: "Delete " + n + " old orders?", text: "Delivered orders older than " + label + " will be deleted for good.", okText: "Delete them", danger: true }))) return;
    showLoading("Deleting...");
    try {
      const del = must(await supabase.from("deliveries").delete().eq("status", "delivered").lt("delivered_at", Date.now() - days * DAY).select("code")) || [];
      del.forEach(x => rows.delete(x.code));
      render();
      paintOld();
      toast("success", del.length + " deleted", "Old orders older than " + label + " were removed.");
    } catch (err) {
      toast("error", "Could not delete", "Run hamstore_admin_fix.sql in Supabase if this keeps happening.");
    } finally {
      hideLoading();
    }
  });

  q("[data-list]").addEventListener("click", async e => {
    const cp = e.target.closest("[data-copy]");
    if (cp) {
      try { await navigator.clipboard.writeText(cp.dataset.copy); toast("success", "Copied", cp.dataset.copy); } catch (err) {}
      return;
    }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const card = btn.closest(".ar-card");
    const r = rows.get(card.dataset.id);
    if (!r) return;
    const act = btn.dataset.act;
    if (act === "copycode") {
      try { await navigator.clipboard.writeText(r.code); toast("success", "Copied", r.code); } catch (err) {}
      return;
    }
    if (act === "map") {
      openRouteMap({ title: r.name, cust: { lat: r.lat, lng: r.lng, name: r.name, address: r.address, phone: r.phone } });
      return;
    }
    if (act === "where") {
      openRouteMap({ title: r.code, cust: { lat: r.delivered_lat, lng: r.delivered_lng, name: "Delivered here", address: r.driver ? "Driver: " + r.driver : "" } });
      return;
    }
    if (act === "slip") {
      showLoading("Preparing slip...");
      try {
        await downloadSlip({ code: r.code, name: r.name, phone: r.phone, address: r.address, createdAt: r.createdAt, total: r.total, items: r.list });
      } catch (err) {
        toast("error", "Could not make the slip", "");
      } finally {
        hideLoading();
      }
      return;
    }
    if (act === "assign") {
      const id = card.querySelector("[data-sel]").value;
      if (!id) return toast("error", "Choose a driver", "Pick the driver from the list first.");
      btn.disabled = true;
      try {
        const { data, error } = await supabase.rpc("admin_assign_order", { p_delivery_code: r.code, p_driver_id: id });
        if (error) throw error;
        if (!data || !data.ok) throw new Error(data && data.code ? data.code : "failed");
        await loadDispatches();
        upsert(r, false);
        toast("success", "Assigned to " + data.driver, "It shows on his dashboard now.");
      } catch (err) {
        btn.disabled = false;
        toast("error", "Could not assign", "Run hamstore_drivers_v4.sql in Supabase, then try again.");
      }
      return;
    }
    if (act === "notify") {
      const x = dm.get(r.code);
      const dv = x && x.driver_id ? driverOf(x.driver_id) : null;
      if (!dv) return;
      const msg = `Hamstore: a new order was assigned to you (${r.name}).\nOpen your dashboard: ${driverLink(dv)}`;
      window.open(`https://wa.me/${waNum(dv.phone)}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
      return;
    }
    if (act === "unassign") {
      const x = dm.get(r.code);
      if (!x) return;
      if (!(await confirmBox({ title: "Take this order off the driver?", text: "It disappears from his dashboard.", okText: "Take off", danger: true }))) return;
      try {
        const up = must(await supabase.from("dispatches").update({ status: "cancelled" }).eq("dcode", x.dcode).select("dcode"));
        if (!up || !up.length) throw new Error("denied");
        dm.delete(r.code);
        upsert(r, false);
        toast("success", "Removed", r.code);
      } catch (err) {
        toast("error", "Could not remove", "You may not have permission.");
      }
      return;
    }
    if (act === "del") {
      if (!(await confirmBox({ title: "Delete this order?", text: r.code + " will be deleted for good.", okText: "Delete", danger: true }))) return;
      try {
        const del = must(await supabase.from("deliveries").delete().eq("code", r.code).select("code"));
        if (!del || !del.length) throw new Error("denied");
        rows.delete(r.code);
        const el = cardEl(r.code);
        if (el) el.remove();
        counts();
        emptyCheck();
        paintOld();
        toast("success", "Deleted", r.code);
      } catch (err) {
        toast("error", "Could not delete", "You may not have permission.");
      }
    }
  });

  setInterval(() => {
    root.querySelectorAll("time.ago").forEach(el => { el.textContent = ago(Number(el.dataset.ts)); });
  }, 60000);

  await Promise.all([loadDrivers(), loadDispatches()]);
  await loadMore();
  paintOld();

  supabase
    .channel("orders-tab")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "deliveries" }, payload => {
      const row = payload.new;
      if (!row || rows.has(row.code)) return;
      const r = norm(row);
      rows.set(r.code, r);
      fetched++;
      upsert(r, true);
      toast("success", "New order", r.code + " · " + naira(r.total), 8000);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "deliveries" }, payload => {
      const row = payload.new;
      const cur = row && rows.get(row.code);
      if (!cur) return;
      Object.assign(cur, norm(row));
      upsert(cur, false);
      paintOld();
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "deliveries" }, payload => {
      const code = payload.old && payload.old.code;
      if (!code || !rows.has(code)) return;
      rows.delete(code);
      const el = cardEl(code);
      if (el) el.remove();
      counts();
      emptyCheck();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "dispatches" }, async () => {
      await loadDispatches();
      render();
    })
    .subscribe();

  return {
    async show() {
      await loadDrivers();
      render();
    }
  };
}
