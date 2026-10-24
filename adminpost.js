import { supabase, must } from "./supabase.js";
import { requireAdmin } from "./guard.js";
import { toast, confirmBox, openModal, imageFieldHTML, imagePicker, esc, naira } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

await requireAdmin("post");

const PAGE = 12;
const $ = id => document.getElementById(id);
const posts = new Map();
const state = { unit: "Carton", category: "Drinks" };
let fetched = 0;
let done = false;
let busy = false;
let editingId = null;


const norm = r => ({ ...r, price: Number(r.price) || 0, createdAt: Number(r.created_at) || 0 });

$("imgField").innerHTML = imageFieldHTML();
const img = imagePicker($("imgField"));

function bindSeg(id, key) {
  const box = $(id);
  const choose = v => {
    state[key] = v;
    box.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
  };
  box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => choose(b.dataset.v)));
  return choose;
}
const setUnit = bindSeg("segUnit", "unit");
const setCat = bindSeg("segCat", "category");

async function fetchPage() {
  const rows = (must(await supabase.from("posts").select("*").order("created_at", { ascending: false }).range(fetched, fetched + PAGE - 1)) || []).map(norm);
  fetched += rows.length;
  if (rows.length < PAGE) done = true;
  return rows;
}

function cardHTML(p) {
  return `<article class="panel item" data-id="${esc(p.id)}">
    <img class="thumb" loading="lazy" decoding="async" src="${esc(p.image)}" alt="${esc(p.name)}" data-act="view">
    <div class="pb">
      <h4>${esc(p.name)}</h4>
      <div class="price">${naira(p.price)}</div>
      <div class="tags"><span class="tag">${esc(p.unit)}</span><span class="tag ${p.category === "Water" ? "w" : "d"}">${esc(p.category)}</span><span class="tag">${esc(p.id)}</span></div>
      <div class="pa">
        <button class="ibtn" data-act="view" aria-label="View"><i class="fa-solid fa-eye"></i></button>
        <button class="ibtn edit" data-act="edit" aria-label="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="ibtn del" data-act="del" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div></article>`;
}

function render() {
  const list = [...posts.values()].sort((a, b) => b.createdAt - a.createdAt);
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
    (await fetchPage()).forEach(r => posts.set(r.id, r));
    render();
  } catch (e) {
    toast("error", "Could not load posts", "Check your internet and try again.");
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
  setUnit("Carton");
  setCat("Drinks");
  $("formTitle").textContent = "New post";
  $("formSub").textContent = "This will show on the Hamstore website.";
  $("submitBtn").querySelector("span").textContent = "Publish post";
  $("cancelEdit").hidden = true;
}
$("cancelEdit").onclick = resetForm;

function startEdit(id) {
  const p = posts.get(id);
  editingId = id;
  $("fName").value = p.name;
  $("fPrice").value = p.price;
  setUnit(p.unit);
  setCat(p.category);
  img.set(p.image);
  $("formTitle").textContent = "Edit " + id;
  $("formSub").textContent = "Change the details, then save.";
  $("submitBtn").querySelector("span").textContent = "Save changes";
  $("cancelEdit").hidden = false;
  $("form").scrollIntoView({ behavior: "smooth", block: "start" });
}

function viewPost(id) {
  const p = posts.get(id);
  const box = document.createElement("div");
  box.innerHTML = `<img class="vimg" src="${esc(p.image)}" alt="${esc(p.name)}"><h3>${esc(p.name)}</h3><div class="price" style="font-size:20px;margin-bottom:10px">${naira(p.price)}</div><div class="tags" style="margin-bottom:16px"><span class="tag">${esc(p.unit)}</span><span class="tag">${esc(p.category)}</span><span class="tag">${esc(p.id)}</span></div><div class="row"><button class="ghost" type="button">Close</button></div>`;
  const close = openModal(box);
  box.querySelector("button").onclick = close;
}

async function removePost(id) {
  if (!(await confirmBox({ title: "Delete this post?", text: "It will be removed from the website. This cannot be undone.", okText: "Delete", danger: true }))) return;
  showLoading("Deleting...");
  try {
    const rows = must(await supabase.from("posts").delete().eq("id", id).select("id"));
    if (!rows || !rows.length) throw new Error("denied");
    posts.delete(id);
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
  if (btn.dataset.act === "view") viewPost(id);
  if (btn.dataset.act === "edit") startEdit(id);
  if (btn.dataset.act === "del") removePost(id);
});

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("fName").value.trim();
  const price = Number($("fPrice").value);
  if (name.length < 2) return toast("error", "Name needed", "Enter the product name.");
  if ($("fPrice").value === "" || !Number.isFinite(price) || price < 0) return toast("error", "Price needed", "Enter a valid price.");
  if (!img.has()) return toast("error", "Image needed", "Upload a photo or paste a link.");
  if (editingId && !(await confirmBox({ title: "Save changes?", text: "The website will show the new details.", okText: "Save" }))) return;

  showLoading(img.uploads() ? "Uploading image..." : "Saving...");
  try {
    const image = await img.resolve();
    const data = { name, price, unit: state.unit, category: state.category, image };
    if (editingId) {
      const rows = must(await supabase.from("posts").update({ ...data, updated_at: Date.now() }).eq("id", editingId).select("*"));
      if (!rows || !rows.length) throw new Error("denied");
      posts.set(editingId, norm(rows[0]));
      toast("success", "Saved", editingId + " was updated.");
    } else {
      
      const row = must(await supabase.from("posts").insert({ ...data, created_at: Date.now() }).select("*").single());
      posts.set(row.id, norm(row));
      toast("success", "Published", row.id + " is now live.");
    }
    resetForm();
    render();
  } catch (err) {
    toast("error", "Could not save", err.message === "upload" ? "Image upload failed. Try again." : "You may not have permission, or the connection failed.");
  } finally {
    hideLoading();
  }
});

showLoading("Loading posts...");
await loadMore();
hideLoading();
