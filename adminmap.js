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
let editingId = null;
let point = null;
let marker = null;

const norm = r => ({ ...r, createdAt: Number(r.created_at) || 0 });

$("imgField").innerHTML = imageFieldHTML();
const img = imagePicker($("imgField"));

const L = await loadMap();
const map = L.map("map").setView([9.0765, 7.3986], 6);
tiles(L).addTo(map);
setTimeout(() => map.invalidateSize(), 300);

function setPoint(lat, lng, zoom) {
  point = { lat, lng };
  if (!marker) {
    marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      point = { lat: p.lat, lng: p.lng };
      $("pin").textContent = `Pin set: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
    });
  } else {
    marker.setLatLng([lat, lng]);
  }
  if (zoom) map.setView([lat, lng], zoom);
  $("pin").textContent = `Pin set: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
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

function paintChips() {
  $("chips").querySelectorAll(".chip").forEach(c => c.classList.toggle("on", flags[c.dataset.k]));
}
$("chips").querySelectorAll(".chip").forEach(c => c.onclick = () => { flags[c.dataset.k] = !flags[c.dataset.k]; paintChips(); });

async function fetchPage() {
  const rows = (must(await supabase.from("branches").select("*").order("created_at", { ascending: false }).range(fetched, fetched + PAGE - 1)) || []).map(norm);
  fetched += rows.length;
  if (rows.length < PAGE) done = true;
  return rows;
}

function cardHTML(b) {
  return `<article class="panel item" data-id="${esc(b.id)}">
    <img class="thumb" loading="lazy" decoding="async" src="${esc(b.image)}" alt="${esc(b.name)}" data-act="view">
    <div class="pb">
      <h4>${esc(b.name)}</h4>
      <p class="meta"><i class="fa-solid fa-location-dot"></i> ${esc(b.address)}</p>
      ${b.phone ? `<p class="meta"><i class="fa-solid fa-phone"></i> ${esc(b.phone)}</p>` : ""}
      <div class="tags">${b.water ? '<span class="tag w">Water</span>' : ""}${b.drinks ? '<span class="tag d">Drinks</span>' : ""}<span class="tag">${esc(b.id)}</span></div>
      <div class="pa">
        <button class="ibtn" data-act="view" aria-label="View"><i class="fa-solid fa-eye"></i></button>
        <button class="ibtn edit" data-act="edit" aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="ibtn del" data-act="del" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div></article>`;
}

function render() {
  const list = [...items.values()].sort((a, b) => b.createdAt - a.createdAt);
  $("grid").innerHTML = list.map(cardHTML).join("");
  $("count").textContent = list.length;
  $("empty").hidden = list.length > 0;
  $("more").hidden = done;
}

async function loadMore() {
  if (busy) return;
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

function resetForm() {
  editingId = null;
  $("form").reset();
  img.clear();
  flags.water = flags.drinks = false;
  paintChips();
  if (marker) { map.removeLayer(marker); marker = null; }
  point = null;
  $("pin").textContent = "Tap the map or drag the pin to set the exact spot.";
  $("formTitle").textContent = "New branch";
  $("formSub").textContent = "Branches show on the website and on its map.";
  $("submitBtn").querySelector("span").textContent = "Add branch";
  $("cancelEdit").hidden = true;
}
$("cancelEdit").onclick = resetForm;

function startEdit(id) {
  const b = items.get(id);
  editingId = id;
  $("fName").value = b.name;
  $("fPhone").value = b.phone || "";
  $("fPhone2").value = b.phone2 || "";
  $("fPhone3").value = b.phone3 || "";
  $("fOpens").value = b.opens || "";
  $("fCloses").value = b.closes || "";
  $("fLink").value = b.link || "";
  $("fAddr").value = b.address;
  img.set(b.image);
  flags.water = !!b.water;
  flags.drinks = !!b.drinks;
  paintChips();
  setPoint(b.lat, b.lng, 16);
  $("formTitle").textContent = "Edit " + id;
  $("formSub").textContent = "Change the details, then save.";
  $("submitBtn").querySelector("span").textContent = "Save changes";
  $("cancelEdit").hidden = false;
  $("form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function viewBranch(id) {
  const b = items.get(id);
  const box = document.createElement("div");
  box.innerHTML = `<img class="vimg" src="${esc(b.image)}" alt="${esc(b.name)}"><h3>${esc(b.name)}</h3><p>${esc(b.address)}</p>
    <div class="row" style="justify-content:flex-start;margin-bottom:14px">
      ${b.phone ? `<a class="btn" href="${telHref(b.phone)}"><i class="fa-solid fa-phone"></i>Call</a>` : ""}
      <a class="btn red" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${b.lat},${b.lng}"><i class="fa-solid fa-diamond-turn-right"></i>Open map</a>
      ${b.link ? `<a class="ghost" target="_blank" rel="noopener" href="${esc(b.link)}">Website</a>` : ""}
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
    render();
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
  const id = btn.closest(".item").dataset.id;
  if (btn.dataset.act === "view") viewBranch(id);
  if (btn.dataset.act === "edit") startEdit(id);
  if (btn.dataset.act === "del") removeBranch(id);
});

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("fName").value.trim();
  const phone = $("fPhone").value.trim();
  const phone2 = $("fPhone2").value.trim();
  const phone3 = $("fPhone3").value.trim();
  const opens = $("fOpens").value;
  const closes = $("fCloses").value;
  const link = $("fLink").value.trim();
  const address = $("fAddr").value.trim();
  if (name.length < 2) return toast("error", "Name needed", "Enter the branch name.");
  if ([phone, phone2, phone3].some(x => x && !/^[0-9+\s-]{7,20}$/.test(x))) return toast("error", "Phone number", "Enter valid phone numbers.");
  if (!!opens !== !!closes) return toast("error", "Opening hours", "Enter both the opening and the closing time, or leave both empty.");
  if (!img.has()) return toast("error", "Image needed", "Upload a photo or paste a link.");
  if (address.length < 5) return toast("error", "Address needed", "Enter the full address.");
  if (!point) return toast("error", "Pin needed", "Tap Find on map, or tap the map to set the spot.");
  if (editingId && !(await confirmBox({ title: "Save changes?", text: "The website will show the new details.", okText: "Save" }))) return;

  showLoading(img.uploads() ? "Uploading image..." : "Saving...");
  try {
    const image = await img.resolve();
    const data = { name, phone, phone2, phone3, opens, closes, link, image, address, lat: point.lat, lng: point.lng, water: flags.water, drinks: flags.drinks };
    if (editingId) {
      const rows = must(await supabase.from("branches").update({ ...data, updated_at: Date.now() }).eq("id", editingId).select("*"));
      if (!rows || !rows.length) throw new Error("denied");
      items.set(editingId, norm(rows[0]));
      toast("success", "Saved", editingId + " was updated.");
    } else {
      // ID (BRANCH0001...) ana bayar da ita kai tsaye daga database
      const row = must(await supabase.from("branches").insert({ ...data, created_at: Date.now() }).select("*").single());
      items.set(row.id, norm(row));
      toast("success", "Branch added", row.id + " is now live.");
    }
    resetForm();
    render();
  } catch (err) {
    toast("error", "Could not save", err.message === "upload" ? "Image upload failed. Try again." : "You may not have permission, or the connection failed.");
  } finally {
    hideLoading();
  }
});

showLoading("Loading branches...");
await loadMore();
hideLoading();
