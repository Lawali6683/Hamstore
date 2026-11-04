import { supabase, must } from "./supabase.js";
import { requireAdmin } from "./guard.js";
import { toast, confirmBox, openModal, imageFieldHTML, imagePicker, loadMap, tiles, geocode, telHref, esc } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

await requireAdmin("branch");

const PAGE = 12;
const $ = id => document.getElementById(id);
const items = new Map();
const flags = { water: false, drinks: false };
let fetched = 0;
let done = false;
let busy = false;
let saving = false;
let editingId = null;
let point = null;
let marker = null;
let term = "";

const norm = r => ({ ...r, createdAt: Number(r.created_at) || 0 });
const safeUrl = u => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");

$("imgField").innerHTML = imageFieldHTML();
const img = imagePicker($("imgField"));

const L = await loadMap();
const map = L.map("map").setView([9.0765, 7.3986], 6);
tiles(L).addTo(map);
setTimeout(() => map.invalidateSize(), 300);
addEventListener("resize", () => setTimeout(() => map.invalidateSize(), 200));

function pinText(lat, lng) {
  $("pin").textContent = `Pin set: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function setPoint(lat, lng, zoom) {
  point = { lat, lng };
  if (!marker) {
    marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      point = { lat: p.lat, lng: p.lng };
      pinText(p.lat, p.lng);
    });
  } else {
    marker.setLatLng([lat, lng]);
  }
  if (zoom) map.setView([lat, lng], zoom);
  pinText(lat, lng);
}
map.on("click", e => setPoint(e.latlng.lat, e.latlng.lng));

$("find").onclick = async () => {
  const text = $("fAddr").value.trim();
  if (text.length < 5) return toast("error", "Address needed", "Type the full address first.");
  showLoading("Finding address...");
  try {
    const hit = await geocode(text);
    if (!hit) toast("error", "Address not found", "Add the town and state, or tap the map.");
    else setPoint(hit.lat, hit.lng, 16);
  } catch (e) {
    toast("error", "Search failed", "Check your internet and try again.");
  } finally {
    hideLoading();
  }
};

$("locate").onclick = () => {
  if (!navigator.geolocation) return toast("error", "Location not available", "Tap the map to set the spot.");
  showLoading("Getting your location...");
  navigator.geolocation.getCurrentPosition(
    p => { hideLoading(); setPoint(p.coords.latitude, p.coords.longitude, 17); },
    () => { hideLoading(); toast("error", "Location blocked", "Allow location access or tap the map."); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 20000 }
  );
};

function paintChips() {
  $("chips").querySelectorAll(".chip").forEach(c => c.classList.toggle("on", flags[c.dataset.k]));
}
$("chips").querySelectorAll(".chip").forEach(c => c.onclick = () => { flags[c.dataset.k] = !flags[c.dataset.k]; paintChips(); });

function openState(b) {
  if (!b.opens || !b.closes) return "";
  const [oh, om] = String(b.opens).split(":").map(Number);
  const [ch, cm] = String(b.closes).split(":").map(Number);
  if ([oh, om, ch, cm].some(n => !Number.isFinite(n))) return "";
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  const o = oh * 60 + om;
  const c = ch * 60 + cm;
  const open = o <= c ? m >= o && m < c : m >= o || m < c;
  return open ? "open" : "closed";
}

function matches(b) {
  if (!term) return true;
  return [b.name, b.address, b.phone, b.phone2, b.phone3, b.id].join(" ").toLowerCase().includes(term);
}

function cardHTML(b) {
  const st = openState(b);
  const phones = [b.phone, b.phone2, b.phone3].filter(Boolean);
  const photo = safeUrl(b.image);
  return `<article class="br-card${editingId === b.id ? " editing" : ""}" data-id="${esc(b.id)}">
    <div class="br-img" data-act="view">${photo ? `<img loading="lazy" decoding="async" src="${esc(photo)}" alt="${esc(b.name)}">` : '<span class="ph"><i class="fa-solid fa-store"></i></span>'}
      <div class="tg">${st ? `<span class="br-chip ${st}">${st === "open" ? "Open now" : "Closed now"}</span>` : ""}${b.water ? '<span class="br-chip w">Water</span>' : ""}${b.drinks ? '<span class="br-chip d">Drinks</span>' : ""}</div>
    </div>
    <div class="br-body">
      <h4>${esc(b.name)}</h4>
      <div class="br-row"><i class="fa-solid fa-location-dot"></i><span>${esc(b.address)}</span></div>
      ${phones.length ? `<div class="br-row"><i class="fa-solid fa-phone"></i><span>${phones.map(esc).join(" · ")}</span></div>` : ""}
      ${b.opens && b.closes ? `<div class="br-row"><i class="fa-regular fa-clock"></i><span>${esc(b.opens)} - ${esc(b.closes)}</span></div>` : ""}
      <span class="br-code">${esc(b.id)}</span>
      <div class="br-btns">
        <button class="br-b" data-act="view" type="button"><i class="fa-solid fa-eye"></i>View</button>
        <button class="br-b edit" data-act="edit" type="button"><i class="fa-solid fa-pen"></i>Edit</button>
        <button class="br-b del" data-act="del" type="button" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div></article>`;
}

function render() {
  const all = [...items.values()].sort((a, b) => b.createdAt - a.createdAt);
  const list = all.filter(matches);
  $("grid").innerHTML = list.map(cardHTML).join("");
  $("count").textContent = all.length;
  $("empty").hidden = list.length > 0;
  $("more").hidden = done;
}

let searchT = 0;
$("q").addEventListener("input", e => {
  clearTimeout(searchT);
  searchT = setTimeout(() => { term = e.target.value.trim().toLowerCase(); render(); }, 160);
});

async function fetchPage() {
  const rows = (must(await supabase.from("branches").select("*").order("created_at", { ascending: false }).range(fetched, fetched + PAGE - 1)) || []).map(norm);
  fetched += rows.length;
  if (rows.length < PAGE) done = true;
  return rows;
}

async function loadMore() {
  if (busy || done) return;
  busy = true;
  $("more").disabled = true;
  try {
    (await fetchPage()).forEach(r => items.set(r.id, r));
    render();
  } catch (e) {
    toast("error", "Could not load branches", "Check your internet and try again.");
  } finally {
    busy = false;
    $("more").disabled = false;
  }
}
$("more").onclick = loadMore;
new IntersectionObserver(en => { if (en[0].isIntersecting) loadMore(); }, { rootMargin: "400px" }).observe($("more"));

function resetForm() {
  editingId = null;
  $("form").reset();
  img.clear();
  flags.water = false;
  flags.drinks = false;
  paintChips();
  if (marker) { map.removeLayer(marker); marker = null; }
  point = null;
  $("pin").textContent = "Tap the map or drag the pin to set the exact spot.";
  $("formTitle").textContent = "New branch";
  $("formSub").textContent = "Branches show on the website and on its map.";
  $("submitBtn").querySelector("span").textContent = "Add branch";
  $("cancelEdit").hidden = true;
  render();
}
$("cancelEdit").onclick = resetForm;

function startEdit(id) {
  const b = items.get(id);
  if (!b) return;
  editingId = id;
  $("fName").value = b.name || "";
  $("fPhone").value = b.phone || "";
  $("fPhone2").value = b.phone2 || "";
  $("fPhone3").value = b.phone3 || "";
  $("fOpens").value = b.opens || "";
  $("fCloses").value = b.closes || "";
  $("fLink").value = b.link || "";
  $("fAddr").value = b.address || "";
  img.set(b.image);
  flags.water = !!b.water;
  flags.drinks = !!b.drinks;
  paintChips();
  if (typeof b.lat === "number" && typeof b.lng === "number") setPoint(b.lat, b.lng, 16);
  $("formTitle").textContent = "Edit " + id;
  $("formSub").textContent = "Change the details, then save.";
  $("submitBtn").querySelector("span").textContent = "Save changes";
  $("cancelEdit").hidden = false;
  render();
  $("formCard").scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => map.invalidateSize(), 400);
}

function viewBranch(id) {
  const b = items.get(id);
  if (!b) return;
  const photo = safeUrl(b.image);
  const box = document.createElement("div");
  box.className = "br-view";
  box.innerHTML = `${photo ? `<img src="${esc(photo)}" alt="${esc(b.name)}">` : ""}<h3>${esc(b.name)}</h3><p>${esc(b.address)}</p>
    <div class="row" style="justify-content:flex-start;margin-bottom:14px">
      ${b.phone ? `<a class="btn" href="${telHref(b.phone)}"><i class="fa-solid fa-phone"></i>Call</a>` : ""}
      <a class="btn red" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}"><i class="fa-solid fa-diamond-turn-right"></i>Open map</a>
      ${safeUrl(b.link) ? `<a class="ghost" target="_blank" rel="noopener" href="${esc(b.link)}">Website</a>` : ""}
    </div><div class="row"><button class="ghost" id="closeView" type="button">Close</button></div>`;
  const close = openModal(box);
  box.querySelector("#closeView").onclick = close;
}

async function removeBranch(id) {
  if (!(await confirmBox({ title: "Delete this branch?", text: "It will be removed from the website and map.", okText: "Delete", danger: true }))) return;
  showLoading("Deleting...");
  try {
    const rows = must(await supabase.from("branches").delete().eq("id", id).select("id"));
    if (!rows || !rows.length) throw new Error("denied");
    items.delete(id);
    if (editingId === id) resetForm();
    else render();
    toast("success", "Deleted", id + " was removed.");
  } catch (e) {
    toast("error", "Could not delete", "You may not have permission.");
  } finally {
    hideLoading();
  }
}

$("grid").addEventListener("click", e => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.closest(".br-card").dataset.id;
  if (btn.dataset.act === "view") viewBranch(id);
  if (btn.dataset.act === "edit") startEdit(id);
  if (btn.dataset.act === "del") removeBranch(id);
});

async function nextId() {
  const rows = must(await supabase.from("branches").select("id").order("id", { ascending: false }).limit(1)) || [];
  const n = rows[0] ? parseInt(String(rows[0].id).replace(/\D/g, ""), 10) || 0 : 0;
  return "BRANCH" + String(n + 1).padStart(4, "0");
}

const isColumnError = e => e && (e.code === "PGRST204" || e.code === "42703" || /column/i.test(String(e.message || "")));

async function insertBranch(data) {
  const base = { ...data, created_at: Date.now() };
  let res = await supabase.from("branches").insert(base).select("*").single();
  if (res.error && res.error.code === "23502") {
    res = await supabase.from("branches").insert({ ...base, id: await nextId() }).select("*").single();
  }
  return must(res);
}

async function updateBranch(id, data) {
  let res = await supabase.from("branches").update({ ...data, updated_at: Date.now() }).eq("id", id).select("*");
  if (res.error && isColumnError(res.error)) {
    res = await supabase.from("branches").update(data).eq("id", id).select("*");
  }
  const rows = must(res);
  if (!rows || !rows.length) throw new Error("denied");
  return rows[0];
}

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  if (saving) return;
  const name = $("fName").value.trim();
  const phone = $("fPhone").value.trim();
  const phone2 = $("fPhone2").value.trim();
  const phone3 = $("fPhone3").value.trim();
  const opens = $("fOpens").value;
  const closes = $("fCloses").value;
  const link = $("fLink").value.trim();
  const address = $("fAddr").value.trim();
  if (name.length < 2) return toast("error", "Name needed", "Enter the branch name.");
  if ([phone, phone2, phone3].some(v => v && !/^[0-9+\s-]{7,20}$/.test(v))) return toast("error", "Phone number", "Enter valid phone numbers.");
  if (!!opens !== !!closes) return toast("error", "Opening hours", "Enter both the opening and the closing time, or leave both empty.");
  if (link && !/^https?:\/\//i.test(link)) return toast("error", "Branch link", "The link must start with http:// or https://");
  if (!img.has()) return toast("error", "Image needed", "Upload a photo or paste a link.");
  if (address.length < 5) return toast("error", "Address needed", "Enter the full address.");
  if (!point) return toast("error", "Pin needed", "Tap Find on map, or tap the map to set the spot.");
  if (editingId && !(await confirmBox({ title: "Save changes?", text: "The website will show the new details.", okText: "Save" }))) return;

  saving = true;
  $("submitBtn").disabled = true;
  showLoading(img.uploads() ? "Uploading image..." : "Saving...");
  try {
    const image = await img.resolve();
    const data = { name, phone, phone2, phone3, opens, closes, link, image, address, lat: point.lat, lng: point.lng, water: flags.water, drinks: flags.drinks };
    if (editingId) {
      const row = await updateBranch(editingId, data);
      items.set(editingId, norm(row));
      toast("success", "Saved", editingId + " was updated.");
    } else {
      const row = await insertBranch(data);
      items.set(row.id, norm(row));
      toast("success", "Branch added", row.id + " is now live.");
    }
    resetForm();
  } catch (err) {
    console.error(err);
    const m = String((err && err.message) || "");
    toast("error", "Could not save", m === "upload" ? "Image upload failed. Try again." : m === "denied" ? "You may not have permission. Run hamstore_admin_fix.sql in Supabase." : "Check your internet, and that the branches table has all the columns.");
  } finally {
    saving = false;
    $("submitBtn").disabled = false;
    hideLoading();
  }
});

showLoading("Loading branches...");
await loadMore();
hideLoading();
