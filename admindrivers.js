import { supabase, must } from "./supabase.js";
import { toast, confirmBox, openModal, loadMap, tiles, dot, km, esc, ago, telHref } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

const ONLINE_MS = 90000;
const LIST_MS = 15000;
const DEFAULT_VIEW = [9.0765, 7.3986];

const isOn = d => !!d.online && Date.now() - Number(d.last_seen || 0) < ONLINE_MS;
const hasPos = d => typeof d.lat === "number" && typeof d.lng === "number";
const waNum = p => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("234")) return d;
  if (d.startsWith("0")) return "234" + d.slice(1);
  return d;
};
const driverLink = k => `${location.origin}/driver.html?k=${encodeURIComponent(k)}`;

export async function mount(root, ctx = {}) {
  root.innerHTML = `
    <div class="dv-top">
      <h3><span class="livedot"></span>Drivers</h3>
      <button class="btn" data-add type="button"><i class="fa-solid fa-user-plus"></i>Register driver</button>
    </div>
    <div class="dv-stats">
      <div class="s on"><i class="fa-solid fa-satellite-dish"></i><b data-n="on">0</b><small>Online now</small></div>
      <div class="s"><i class="fa-solid fa-moon"></i><b data-n="off">0</b><small>Offline</small></div>
      <div class="s"><i class="fa-solid fa-id-card"></i><b data-n="all">0</b><small>Registered</small></div>
      <div class="s bad"><i class="fa-solid fa-ban"></i><b data-n="blk">0</b><small>Blocked</small></div>
    </div>
    <section class="dv-mapcard"><div class="dv-map" data-map></div></section>
    <div class="chips" data-tabs>
      <button class="chip on" data-t="online">Online</button>
      <button class="chip" data-t="offline">Offline</button>
      <button class="chip" data-t="blocked">Blocked</button>
      <button class="chip" data-t="all">All</button>
    </div>
    <div class="dv-list" data-list></div>
    <div class="empty" data-empty hidden><i class="fa-solid fa-id-card" style="font-size:28px"></i><p>No drivers here. Register one to get started.</p></div>`;

  const q = s => root.querySelector(s);
  const drivers = new Map();
  const markers = new Map();
  let filter = "online";
  let L = null;
  let map = null;
  let timer = 0;
  let sub = null;

  const counts = () => {
    let on = 0, off = 0, blk = 0;
    drivers.forEach(d => {
      if (d.status !== "active") blk++;
      else if (isOn(d)) on++;
      else off++;
    });
    q('[data-n="on"]').textContent = on;
    q('[data-n="off"]').textContent = off;
    q('[data-n="all"]').textContent = drivers.size;
    q('[data-n="blk"]').textContent = blk;
    if (ctx.badge) ctx.badge("drv", on);
  };

  const visible = d => {
    if (filter === "online") return d.status === "active" && isOn(d);
    if (filter === "offline") return d.status === "active" && !isOn(d);
    if (filter === "blocked") return d.status !== "active";
    return true;
  };

  const cardHTML = d => {
    const on = isOn(d);
    const blocked = d.status !== "active";
    const state = blocked ? "blocked" : on ? "online" : "offline";
    const label = blocked ? "Blocked" : on ? "Online" : "Offline";
    const seen = Number(d.last_seen) || 0;
    return `<article class="dr-card ${state}" data-id="${esc(d.id)}">
      <div class="dr-av"><i class="fa-solid fa-id-card-clip"></i><span class="dot"></span></div>
      <div class="dr-mid">
        <h4>${esc(d.name)}</h4>
        <div class="dr-meta">${d.phone ? `<span><i class="fa-solid fa-phone"></i>${esc(d.phone)}</span>` : ""}${d.vehicle ? `<span><i class="fa-solid fa-truck"></i>${esc(d.vehicle)}</span>` : ""}</div>
        <div class="dr-sub"><span class="st ${state}">${label}</span><span>${seen ? "Seen " + esc(ago(seen)) : "Never opened the dashboard"}</span></div>
      </div>
      <div class="dr-acts">
        ${hasPos(d) ? '<button class="dr-b" data-act="focus" type="button" aria-label="Show on map"><i class="fa-solid fa-location-crosshairs"></i></button>' : ""}
        ${d.phone ? `<a class="dr-b" href="${telHref(d.phone)}" aria-label="Call"><i class="fa-solid fa-phone"></i></a>` : ""}
        ${d.phone ? `<a class="dr-b wa" target="_blank" rel="noopener" href="https://wa.me/${waNum(d.phone)}?text=${encodeURIComponent("Hamstore dashboard link: " + driverLink(d.dkey))}" aria-label="WhatsApp"><i class="fa-brands fa-whatsapp"></i></a>` : ""}
        <button class="dr-b" data-act="history" type="button" aria-label="History"><i class="fa-solid fa-route"></i></button>
        <button class="dr-b" data-act="copy" type="button" aria-label="Copy link"><i class="fa-regular fa-copy"></i></button>
        <button class="dr-b" data-act="reset" type="button" aria-label="New key"><i class="fa-solid fa-rotate"></i></button>
        <button class="dr-b${blocked ? " ok" : " warn"}" data-act="block" type="button" aria-label="${blocked ? "Unblock" : "Block"}"><i class="fa-solid ${blocked ? "fa-circle-check" : "fa-ban"}"></i></button>
        <button class="dr-b del" data-act="del" type="button" aria-label="Remove"><i class="fa-solid fa-trash"></i></button>
      </div></article>`;
  };

  const markerHTML = d => `<div class="dr-pin ${isOn(d) ? "on" : "off"}"><i class="fa-solid fa-truck-fast"></i><span>${esc(String(d.name).split(" ")[0])}</span></div>`;

  const paintMarkers = () => {
    if (!map) return;
    const keep = new Set();
    drivers.forEach(d => {
      if (!hasPos(d) || d.status !== "active") return;
      if (!isOn(d) && filter !== "all" && filter !== "offline") return;
      keep.add(d.id);
      const icon = L.divIcon({ className: "", iconSize: [110, 44], iconAnchor: [55, 22], html: markerHTML(d) });
      let m = markers.get(d.id);
      if (!m) {
        m = L.marker([d.lat, d.lng], { icon, zIndexOffset: isOn(d) ? 300 : 0 }).addTo(map);
        m.bindPopup(`<b>${esc(d.name)}</b><br>${esc(d.phone || "")}`);
        markers.set(d.id, m);
      } else {
        m.setLatLng([d.lat, d.lng]);
        m.setIcon(icon);
      }
    });
    markers.forEach((m, id) => {
      if (!keep.has(id)) { map.removeLayer(m); markers.delete(id); }
    });
  };

  const render = () => {
    counts();
    const list = [...drivers.values()].filter(visible).sort((a, b) => (isOn(b) - isOn(a)) || String(a.name).localeCompare(String(b.name)));
    q("[data-list]").innerHTML = list.map(cardHTML).join("");
    q("[data-empty]").hidden = list.length > 0;
    paintMarkers();
  };

  const loadAll = async () => {
    try {
      const rows = must(await supabase.from("drivers").select("*").order("name", { ascending: true })) || [];
      drivers.clear();
      rows.forEach(r => drivers.set(r.id, { ...r, last_seen: Number(r.last_seen) || 0 }));
    } catch (e) {
      toast("error", "Could not load drivers", "Check your internet and try again.");
    }
    render();
  };

  const showKey = d => {
    const link = driverLink(d.dkey);
    const msg = `Hamstore driver dashboard for ${d.name}.\nYour code: ${d.dkey}\nOpen this link on your phone and keep it open while you work:\n${link}`;
    const box = document.createElement("div");
    box.className = "dr-form";
    box.innerHTML = `<h3>${esc(d.name)} is registered</h3>
      <p class="hint">Send this link to the driver. Keep it private: anyone with it can open the driver dashboard.</p>
      <div class="dr-key"><small>Driver code</small><b>${esc(d.dkey)}</b></div>
      <div class="dr-link">${esc(link)}</div>
      <div class="row" style="justify-content:flex-start;margin-top:12px"><a class="btn" target="_blank" rel="noopener" href="https://wa.me/${d.phone ? waNum(d.phone) : ""}?text=${encodeURIComponent(msg)}"><i class="fa-brands fa-whatsapp"></i>Send on WhatsApp</a><button class="ghost" data-kcopy type="button"><i class="fa-regular fa-copy"></i>Copy message</button><button class="ghost" data-kdone type="button">Done</button></div>`;
    const close = openModal(box);
    box.querySelector("[data-kdone]").onclick = close;
    box.querySelector("[data-kcopy]").onclick = async () => {
      try { await navigator.clipboard.writeText(msg); toast("success", "Copied", d.dkey); } catch (e) {}
    };
  };

  const driverForm = () => {
    const box = document.createElement("div");
    box.className = "dr-form";
    box.innerHTML = `<h3>Register a driver</h3>
      <p class="hint">The driver gets a private link. He opens it on his phone, his location is shared while the page is open, and he sees the orders you assign to him.</p>
      <div class="field"><i class="fa-solid fa-user lead"></i><input data-f="name" type="text" maxlength="60" placeholder="Full name"></div>
      <div class="field"><i class="fa-solid fa-phone lead"></i><input data-f="phone" type="tel" maxlength="20" placeholder="Phone number"></div>
      <div class="field"><i class="fa-solid fa-truck lead"></i><input data-f="veh" type="text" maxlength="60" placeholder="Vehicle (optional)"></div>
      <div class="row"><button class="ghost" data-fc type="button">Cancel</button><button class="btn" data-fs type="button"><i class="fa-solid fa-user-plus"></i>Register</button></div>`;
    const close = openModal(box);
    box.querySelector("[data-fc]").onclick = close;
    box.querySelector("[data-fs]").onclick = async () => {
      const name = box.querySelector('[data-f="name"]').value.trim();
      const phone = box.querySelector('[data-f="phone"]').value.trim();
      const vehicle = box.querySelector('[data-f="veh"]').value.trim();
      if (name.length < 2) return toast("error", "Name needed", "Enter the driver's full name.");
      if (phone && !/^[0-9+\s-]{7,20}$/.test(phone)) return toast("error", "Phone number", "Enter a valid phone number.");
      const btn = box.querySelector("[data-fs]");
      btn.disabled = true;
      showLoading("Registering...");
      try {
        const { data, error } = await supabase.rpc("admin_create_driver", { p_name: name, p_phone: phone, p_vehicle: vehicle });
        if (error) throw error;
        if (!data || !data.ok) throw new Error(data && data.code ? data.code : "failed");
        close();
        await loadAll();
        showKey({ name, phone, dkey: data.dkey });
      } catch (err) {
        btn.disabled = false;
        toast("error", "Could not register", "Run hamstore_drivers_v4.sql in Supabase, then try again.");
      } finally {
        hideLoading();
      }
    };
  };

  const dist = (a, b) => km(a, b) * 1000;

  const openHistory = async d => {
    const box = document.createElement("div");
    box.className = "dr-form dr-hist";
    box.innerHTML = `<h3>${esc(d.name)} - history</h3>
      <div class="dr-days"><button class="chip on" type="button" data-days="1">Today</button><button class="chip" type="button" data-days="7">Last 7 days</button></div>
      <div class="dr-hmap" data-hmap></div>
      <div class="dr-hstats" data-hstats></div>
      <div class="dr-stops" data-stops></div>
      <div class="row" style="justify-content:flex-start"><button class="ghost" type="button" data-hclose>Close</button></div>`;
    const close = openModal(box);
    box.querySelector("[data-hclose]").onclick = close;
    const LL = await loadMap();
    const hm = LL.map(box.querySelector("[data-hmap]"), { zoomControl: true }).setView(hasPos(d) ? [d.lat, d.lng] : DEFAULT_VIEW, 15);
    tiles(LL).addTo(hm);
    setTimeout(() => hm.invalidateSize(), 250);
    let layers = [];
    const clear = () => { layers.forEach(l => hm.removeLayer(l)); layers = []; };
    const fmtT = ts => new Date(ts).toLocaleString("en-NG", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
    const fmtMins = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + " min" : Math.floor(m / 60) + "h " + (m % 60) + "m"; };

    const draw = async days => {
      box.querySelectorAll("[data-days]").forEach(b => b.classList.toggle("on", Number(b.dataset.days) === days));
      box.querySelector("[data-hstats]").innerHTML = "<span>Loading...</span>";
      box.querySelector("[data-stops]").innerHTML = "";
      clear();
      const { data, error } = await supabase.rpc("admin_driver_history", { p_id: d.id, p_days: days });
      if (error || !data || !data.ok) {
        box.querySelector("[data-hstats]").innerHTML = "<span>Could not load history. Run hamstore_v5_tracking.sql in Supabase.</span>";
        return;
      }
      const pts = (data.points || []).map(p => ({ lat: Number(p.lat), lng: Number(p.lng), at: Number(p.at) }));
      if (!pts.length) {
        box.querySelector("[data-hstats]").innerHTML = "<span>No movement recorded for this period.</span>";
        return;
      }
      const line = pts.map(p => [p.lat, p.lng]);
      const trail = LL.polyline(line, { color: "#1a73e8", weight: 5, opacity: 0.9 }).addTo(hm);
      const start = LL.marker(line[0], { icon: dot(LL, "#2fb36d") }).addTo(hm).bindPopup("Start " + fmtT(pts[0].at));
      const last = LL.marker(line[line.length - 1], { icon: dot(LL, "#e03a3a") }).addTo(hm).bindPopup("Last seen " + fmtT(pts[pts.length - 1].at));
      layers.push(trail, start, last);

      let total = 0;
      for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);

      const stops = [];
      let anchor = pts[0];
      let from = 0;
      const closeGroup = to => {
        const dur = pts[to].at - pts[from].at;
        if (dur >= 120000) stops.push({ lat: anchor.lat, lng: anchor.lng, from: pts[from].at, to: pts[to].at, dur });
      };
      for (let i = 1; i < pts.length; i++) {
        if (dist(anchor, pts[i]) > 25) {
          closeGroup(i - 1);
          anchor = pts[i];
          from = i;
        }
      }
      closeGroup(pts.length - 1);

      stops.forEach((s, n) => {
        const m = LL.marker([s.lat, s.lng], { icon: LL.divIcon({ className: "", iconSize: [28, 28], iconAnchor: [14, 14], html: `<div class="dr-stop">${n + 1}</div>` }) }).addTo(hm);
        m.bindPopup(`Stopped ${fmtMins(s.dur)}<br>${fmtT(s.from)} - ${fmtT(s.to)}`);
        layers.push(m);
      });

      hm.fitBounds(trail.getBounds().pad(0.2));
      box.querySelector("[data-hstats]").innerHTML = `<div><small>Distance</small><b>${(total / 1000).toFixed(1)} km</b></div><div><small>Stops (2+ min)</small><b>${stops.length}</b></div><div><small>Last seen</small><b>${esc(fmtT(pts[pts.length - 1].at))}</b></div>`;
      box.querySelector("[data-stops]").innerHTML = stops.length
        ? stops.map((s, n) => `<div class="dr-stop-row"><i>${n + 1}</i><span>${esc(fmtT(s.from))} - ${esc(fmtT(s.to))}</span><b>${esc(fmtMins(s.dur))}</b></div>`).join("")
        : "<span>No stops of 2 minutes or more.</span>";
    };

    box.querySelectorAll("[data-days]").forEach(b => { b.onclick = () => draw(Number(b.dataset.days)); });
    draw(1);
  };

  const act = async (id, what) => {
    const d = drivers.get(id);
    if (!d) return;
    if (what === "history") return openHistory(d);
    if (what === "copy") {
      try { await navigator.clipboard.writeText(driverLink(d.dkey)); toast("success", "Link copied", d.name); } catch (e) {}
      return;
    }
    if (what === "focus") {
      if (map && hasPos(d)) map.setView([d.lat, d.lng], 16, { animate: true });
      const m = markers.get(id);
      if (m) m.openPopup();
      return;
    }
    if (what === "reset") {
      if (!(await confirmBox({ title: "Make a new link for " + d.name + "?", text: "The old link stops working. He must open the new one.", okText: "New link", danger: true }))) return;
      try {
        const { data, error } = await supabase.rpc("admin_reset_driver_key", { p_id: id });
        if (error) throw error;
        if (!data || !data.ok) throw new Error("failed");
        await loadAll();
        showKey({ name: d.name, phone: d.phone, dkey: data.dkey });
      } catch (e) {
        toast("error", "Could not make a new link", "Run hamstore_drivers_v4.sql in Supabase.");
      }
      return;
    }
    if (what === "block") {
      const next = d.status === "active" ? "blocked" : "active";
      if (next === "blocked" && !(await confirmBox({ title: "Block " + d.name + "?", text: "He cannot open his dashboard or receive orders until you unblock him.", okText: "Block", danger: true }))) return;
      try {
        const up = must(await supabase.from("drivers").update({ status: next, online: false }).eq("id", id).select("id"));
        if (!up || !up.length) throw new Error("denied");
        await loadAll();
        toast("success", next === "blocked" ? "Blocked" : "Unblocked", d.name);
      } catch (e) {
        toast("error", "Could not update", "You may not have permission.");
      }
      return;
    }
    if (what === "del") {
      if (!(await confirmBox({ title: "Remove " + d.name + "?", text: "Orders already assigned to him are kept for review. He loses access.", okText: "Remove", danger: true }))) return;
      try {
        const del = must(await supabase.from("drivers").delete().eq("id", id).select("id"));
        if (!del || !del.length) throw new Error("denied");
        drivers.delete(id);
        const m = markers.get(id);
        if (m && map) map.removeLayer(m);
        markers.delete(id);
        render();
        toast("success", "Removed", d.name);
      } catch (e) {
        toast("error", "Could not remove", "You may not have permission.");
      }
    }
  };

  q("[data-list]").addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    act(b.closest(".dr-card").dataset.id, b.dataset.act);
  });

  q("[data-tabs]").querySelectorAll(".chip").forEach(c => c.onclick = () => {
    filter = c.dataset.t;
    q("[data-tabs]").querySelectorAll(".chip").forEach(z => z.classList.toggle("on", z === c));
    render();
  });

  q("[data-add]").onclick = driverForm;

  L = await loadMap();
  map = L.map(q("[data-map]"), { zoomControl: true }).setView(DEFAULT_VIEW, 6);
  tiles(L).addTo(map);
  addEventListener("resize", () => map && setTimeout(() => map.invalidateSize(), 200));

  showLoading("Loading drivers...");
  await loadAll();
  hideLoading();

  sub = supabase
    .channel("drivers-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "drivers" }, () => loadAll())
    .subscribe();

  return {
    show() {
      setTimeout(() => { if (map) map.invalidateSize(); }, 150);
      loadAll();
      clearInterval(timer);
      timer = setInterval(render, LIST_MS);
    },
    hide() {
      clearInterval(timer);
    }
  };
}
