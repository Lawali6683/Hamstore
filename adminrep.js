import { supabase, must } from "./supabase.js";
import { requireAdmin } from "./guard.js";
import { toast, confirmBox, openModal, loadMap, tiles, dot, nearest, telHref, esc, ago } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

await requireAdmin("rep");

const PAGE = 12;
const $ = id => document.getElementById(id);
const items = new Map();
const branches = [];
let done = false;
let busy = false;
let fetched = 0;
let filter = "new";

const KINDS = {
  order: ["fa-cart-shopping", "Order"],
  stock: ["fa-box-open", "No stock"],
  message: ["fa-message", "Message"]
};


const norm = r => ({
  ...r,
  createdAt: Number(r.created_at) || 0,
  branchName: r.branch_name,
  branchId: r.branch_id
});

async function fetchPage() {
  const from = fetched;
  const rows = (must(await supabase.from("requests").select("*").order("created_at", { ascending: false }).range(from, from + PAGE - 1)) || []).map(norm);
  fetched += rows.length;
  if (rows.length < PAGE) done = true;
  return rows;
}

function passes(r) {
  if (filter === "all") return true;
  if (filter === "new") return r.status !== "done";
  if (filter === "done") return r.status === "done";
  return r.kind === filter;
}

function cardHTML(r) {
  const [icon, label] = KINDS[r.kind] || KINDS.message;
  const has = typeof r.lat === "number";
  const near = has ? nearest(r, branches) : null;
  const isDone = r.status === "done";
  return `<article class="panel req ${isDone ? "done" : "new"}" data-id="${esc(r.id)}">
    <div class="rh"><h4>${esc(r.name)}</h4><span class="kind ${esc(r.kind)}"><i class="fa-solid ${icon}"></i>${label}</span></div>
    <p class="meta"><i class="fa-solid fa-phone"></i> ${esc(r.phone)} &nbsp;·&nbsp; ${ago(r.createdAt)}</p>
    ${r.items ? `<p class="msg"><b>Items:</b> ${esc(r.items)}</p>` : ""}
    ${r.message ? `<p class="msg">${esc(r.message)}</p>` : ""}
    ${r.address ? `<p class="meta"><i class="fa-solid fa-location-dot"></i> ${esc(r.address)}</p>` : ""}
    ${r.branchName ? `<p class="meta"><i class="fa-solid fa-store"></i> ${esc(r.branchName)}</p>` : ""}
    ${near ? `<p class="near"><i class="fa-solid fa-store"></i> Nearest: ${esc(near.branch.name)} (${near.d.toFixed(1)} km)</p>` : ""}
    <div class="ra">
      <a class="btn sm" href="${telHref(r.phone)}"><i class="fa-solid fa-phone"></i>Call</a>
      ${has ? '<button class="ghost sm" data-act="map" type="button"><i class="fa-solid fa-map-location-dot"></i>Map</button>' : ""}
      ${near && near.branch.phone ? `<a class="ghost sm" href="${telHref(near.branch.phone)}"><i class="fa-solid fa-store"></i>Call branch</a>` : ""}
      ${r.voice ? '<button class="ghost sm" data-act="voice" type="button"><i class="fa-solid fa-circle-play"></i>Voice</button>' : ""}
      <button class="ghost sm" data-act="done" type="button"><i class="fa-solid ${isDone ? "fa-rotate-left" : "fa-check"}"></i>${isDone ? "Reopen" : "Done"}</button>
      <button class="ibtn del" data-act="del" type="button" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
    </div></article>`;
}

function render() {
  const list = [...items.values()].filter(passes).sort((a, b) => b.createdAt - a.createdAt);
  $("list").innerHTML = list.map(cardHTML).join("");
  $("empty").hidden = list.length > 0;
  $("more").hidden = done;
}

$("filters").querySelectorAll(".chip").forEach(c => c.onclick = () => {
  filter = c.dataset.f;
  $("filters").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === c));
  render();
});

async function loadMore() {
  if (busy) return;
  busy = true;
  $("more").disabled = true;
  try {
    (await fetchPage()).forEach(r => items.set(r.id, r));
    render();
  } catch (e) {
    toast("error", "Could not load requests", "Check your internet and try again.");
  } finally {
    busy = false;
    $("more").disabled = false;
  }
}
$("more").onclick = loadMore;

async function showMap(r) {
  const box = document.createElement("div");
  box.innerHTML = `<h3>${esc(r.name)}</h3><div class="map modalmap"></div><div class="row"><button class="ghost" type="button">Close</button></div>`;
  const close = openModal(box);
  box.querySelector("button").onclick = close;
  const L = await loadMap();
  const m = L.map(box.querySelector(".map")).setView([r.lat, r.lng], 14);
  tiles(L).addTo(m);
  L.marker([r.lat, r.lng], { icon: dot(L, "#e03a3a") }).addTo(m).bindPopup(esc(r.name)).openPopup();
  const near = nearest(r, branches);
  if (near) {
    const b = near.branch;
    L.marker([b.lat, b.lng], { icon: dot(L, "#2fb36d") }).addTo(m).bindPopup(esc(b.name));
    L.polyline([[r.lat, r.lng], [b.lat, b.lng]], { color: "#2fb36d", dashArray: "6 8" }).addTo(m);
    m.fitBounds([[r.lat, r.lng], [b.lat, b.lng]], { padding: [40, 40] });
  }
  setTimeout(() => m.invalidateSize(), 250);
}

$("list").addEventListener("click", async e => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.closest(".req").dataset.id;
  const r = items.get(id);
  if (!r) return;
  if (btn.dataset.act === "map") return showMap(r);
  if (btn.dataset.act === "voice") {
    try {
      const v = must(await supabase.from("voices").select("data").eq("request_id", id).maybeSingle());
      if (!v || !v.data) return toast("error", "No voice note", "The voice note was not found.");
      const box = document.createElement("div");
      box.innerHTML = `<h3>${esc(r.name)}</h3><audio controls autoplay style="width:100%"></audio><div class="row" style="margin-top:12px"><button class="ghost" type="button">Close</button></div>`;
      box.querySelector("audio").src = v.data;
      const close = openModal(box);
      box.querySelector("button").onclick = close;
    } catch (err) {
      toast("error", "Could not load", "You may not have permission.");
    }
    return;
  }
  if (btn.dataset.act === "done") {
    const status = r.status === "done" ? "new" : "done";
    try {
      const rows = must(await supabase.from("requests").update({ status }).eq("id", id).select("id"));
      if (!rows || !rows.length) throw new Error("denied");
      r.status = status;
      render();
    } catch (err) {
      toast("error", "Could not update", "You may not have permission.");
    }
  }
  if (btn.dataset.act === "del") {
    if (!(await confirmBox({ title: "Delete this request?", text: "This cannot be undone.", okText: "Delete", danger: true }))) return;
    try {
      const rows = must(await supabase.from("requests").delete().eq("id", id).select("id"));
      if (!rows || !rows.length) throw new Error("denied");
      items.delete(id);
      render();
      toast("success", "Deleted", "The request was removed.");
    } catch (err) {
      toast("error", "Could not delete", "You may not have permission.");
    }
  }
});

$("settings").onclick = async () => {
  const box = document.createElement("div");
  box.innerHTML = `<h3>Contact numbers</h3><p>These numbers show on the website so people can call.</p><div id="phones"></div>
    <div class="field"><i class="fa-solid fa-tag lead"></i><input id="pLabel" type="text" maxlength="40" placeholder="Label, for example Sales"></div>
    <div class="field"><i class="fa-solid fa-phone lead"></i><input id="pNum" type="tel" placeholder="Phone number"></div>
    <div class="row"><button class="ghost" id="pClose" type="button">Close</button><button class="btn" id="pAdd" type="button"><i class="fa-solid fa-plus"></i>Save number</button></div>`;
  const close = openModal(box);
  box.querySelector("#pClose").onclick = close;
  const holder = box.querySelector("#phones");
  const draw = async () => {
    let rows = [];
    try {
      rows = must(await supabase.from("phones").select("*").order("created_at", { ascending: true })) || [];
    } catch (err) {
      toast("error", "Could not load numbers", "Check your internet and try again.");
    }
    holder.innerHTML = "";
    rows.forEach(v => {
      const row = document.createElement("div");
      row.className = "ph";
      row.innerHTML = `<span><b></b><br><span class="meta"></span></span><button class="ibtn del" type="button" aria-label="Remove"><i class="fa-solid fa-trash"></i></button>`;
      row.querySelector("b").textContent = v.label;
      row.querySelector(".meta").textContent = v.number;
      row.querySelector("button").onclick = async () => {
        if (!(await confirmBox({ title: "Remove this number?", text: v.number, okText: "Remove", danger: true }))) return;
        try {
          const del = must(await supabase.from("phones").delete().eq("id", v.id).select("id"));
          if (!del || !del.length) throw new Error("denied");
          draw();
        } catch (err) {
          toast("error", "Could not remove", "You may not have permission.");
        }
      };
      holder.appendChild(row);
    });
  };
  await draw();
  box.querySelector("#pAdd").onclick = async () => {
    const label = box.querySelector("#pLabel").value.trim();
    const number = box.querySelector("#pNum").value.trim();
    if (!label || !/^[0-9+\s-]{7,20}$/.test(number)) return toast("error", "Check details", "Enter a label and a valid number.");
    try {
      must(await supabase.from("phones").insert({ label, number }));
      box.querySelector("#pLabel").value = "";
      box.querySelector("#pNum").value = "";
      toast("success", "Saved", number + " was added.");
      draw();
    } catch (err) {
      toast("error", "Could not save", "You may not have permission.");
    }
  };
};

showLoading("Loading requests...");
try {
  const rows = must(await supabase.from("branches").select("*").order("created_at", { ascending: false }).limit(200)) || [];
  rows.forEach(b => { if (typeof b.lat === "number" && typeof b.lng === "number") branches.push(b); });
} catch (e) {}
await loadMore();
hideLoading();


supabase
  .channel("requests-new")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "requests" }, payload => {
    const row = payload.new;
    if (!row || items.has(row.id)) return;
    const r = norm(row);
    items.set(r.id, r);
    render();
    toast("success", "New " + (KINDS[r.kind] || KINDS.message)[1].toLowerCase(), r.name + " · " + r.phone, 8000);
  })
  .subscribe();
