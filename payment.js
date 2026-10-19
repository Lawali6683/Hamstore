import { app } from "./firebase.js";
import { getDatabase, ref, get, push, update, remove, query, orderByChild, limitToLast, startAt, onChildAdded } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";
import { requireAdmin } from "./guard.js";
import { toast, confirmBox, openModal, esc, naira, ago, telHref } from "./allui.js";
import { showLoading, hideLoading } from "./loading.js";

const db = getDatabase(app);
await requireAdmin("pay");

const $ = id => document.getElementById(id);
const items = new Map();
let tab = "pending";

function stats() {
  let p = 0, pt = 0, d = 0, dt = 0;
  items.forEach(o => {
    if (o.status === "done") { d++; dt += o.total; } else { p++; pt += o.total; }
  });
  $("sPend").textContent = p;
  $("sPendT").textContent = "Waiting: " + naira(pt);
  $("sDone").textContent = d;
  $("sDoneT").textContent = "Completed: " + naira(dt);
}

function cardHTML(o) {
  const done = o.status === "done";
  return `<article class="panel req ${done ? "done" : "new"}" data-id="${esc(o.id)}">
    <div class="rh"><h4>${esc(o.code)}</h4><span class="chipc ${done ? "ok" : "wait"}">${done ? "Completed" : "Waiting"}</span></div>
    <p class="meta"><i class="fa-solid fa-user"></i> ${esc(o.name)} · <i class="fa-solid fa-phone"></i> ${esc(o.phone)} · ${ago(o.createdAt)}</p>
    <p class="meta"><i class="fa-solid fa-location-dot"></i> ${esc(o.address)}</p>
    <div style="display:grid;gap:4px">${(o.items || []).map(i => `<p class="msg">${esc(i.name)} <span class="meta">(${esc(i.unit)}) ${i.qty} × ${naira(i.price)}</span> = <b>${naira(i.line)}</b></p>`).join("")}</div>
    <p class="msg" style="font-size:18px"><b>Total: ${naira(o.total)}</b></p>
    <div class="ra">
      <a class="btn sm" href="${telHref(o.phone)}"><i class="fa-solid fa-phone"></i>Call</a>
      <button class="ghost sm" data-act="shot" type="button"><i class="fa-solid fa-image"></i>Screenshot</button>
      <button class="ghost sm" data-act="done" type="button"><i class="fa-solid ${done ? "fa-rotate-left" : "fa-check"}"></i>${done ? "Reopen" : "Completed"}</button>
      <button class="ibtn del" data-act="del" type="button" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
    </div></article>`;
}

function render() {
  stats();
  const list = [...items.values()].filter(o => tab === "all" || (tab === "done" ? o.status === "done" : o.status !== "done")).sort((a, b) => b.createdAt - a.createdAt);
  $("list").innerHTML = list.map(cardHTML).join("");
  $("empty").hidden = list.length > 0;
}

$("tabs").querySelectorAll(".chip").forEach(c => c.onclick = () => {
  tab = c.dataset.t;
  $("tabs").querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === c));
  render();
});

$("list").addEventListener("click", async e => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.closest(".req").dataset.id;
  const o = items.get(id);
  if (btn.dataset.act === "shot") {
    const box = document.createElement("div");
    box.innerHTML = `<h3>${esc(o.code)}</h3><img class="vimg" alt="Payment screenshot" style="max-height:70vh;object-fit:contain"><div class="row"><a class="ghost" target="_blank" rel="noopener">Open full size</a><button class="btn" type="button">Close</button></div>`;
    box.querySelector("img").src = o.shot;
    box.querySelector("a").href = o.shot;
    const close = openModal(box);
    box.querySelector("button").onclick = close;
  }
  if (btn.dataset.act === "done") {
    const status = o.status === "done" ? "pending" : "done";
    try {
      await update(ref(db, "payments/" + id), { status });
      o.status = status;
      render();
      toast("success", status === "done" ? "Completed" : "Reopened", o.code);
    } catch (err) {
      toast("error", "Could not update", "You may not have permission.");
    }
  }
  if (btn.dataset.act === "del") {
    if (!(await confirmBox({ title: "Delete this payment?", text: o.code + " will be removed for good.", okText: "Delete", danger: true }))) return;
    try {
      await remove(ref(db, "payments/" + id));
      items.delete(id);
      render();
      toast("success", "Deleted", o.code);
    } catch (err) {
      toast("error", "Could not delete", "You may not have permission.");
    }
  }
});

$("accounts").onclick = async () => {
  const box = document.createElement("div");
  box.innerHTML = `<h3>Account numbers</h3><p>Customers see these on the payment page.</p><div id="aList"></div>
    <div class="field"><i class="fa-solid fa-building-columns lead"></i><input id="aBank" type="text" maxlength="40" placeholder="Bank name"></div>
    <div class="field"><i class="fa-solid fa-user lead"></i><input id="aName" type="text" maxlength="60" placeholder="Account name"></div>
    <div class="field"><i class="fa-solid fa-hashtag lead"></i><input id="aNum" type="text" inputmode="numeric" maxlength="20" placeholder="Account number"></div>
    <div class="row"><button class="ghost" id="aClose" type="button">Close</button><button class="btn" id="aAdd" type="button"><i class="fa-solid fa-plus"></i>Save account</button></div>`;
  const close = openModal(box);
  box.querySelector("#aClose").onclick = close;
  const holder = box.querySelector("#aList");
  const draw = async () => {
    const snap = await get(ref(db, "settings/payment"));
    holder.innerHTML = "";
    snap.forEach(c => {
      const v = c.val();
      const row = document.createElement("div");
      row.className = "ph";
      row.innerHTML = `<span><b></b><br><span class="meta"></span></span><button class="ibtn del" type="button" aria-label="Remove"><i class="fa-solid fa-trash"></i></button>`;
      row.querySelector("b").textContent = v.number;
      row.querySelector(".meta").textContent = v.bank + " · " + v.name;
      row.querySelector("button").onclick = async () => {
        if (!(await confirmBox({ title: "Remove this account?", text: v.number, okText: "Remove", danger: true }))) return;
        try { await remove(ref(db, "settings/payment/" + c.key)); draw(); } catch (err) { toast("error", "Could not remove", "You may not have permission."); }
      };
      holder.appendChild(row);
    });
  };
  await draw();
  box.querySelector("#aAdd").onclick = async () => {
    const bank = box.querySelector("#aBank").value.trim();
    const name = box.querySelector("#aName").value.trim();
    const number = box.querySelector("#aNum").value.trim();
    if (bank.length < 2 || name.length < 2 || !/^[0-9]{6,20}$/.test(number)) return toast("error", "Check details", "Enter the bank, the account name and a valid number.");
    try {
      await push(ref(db, "settings/payment"), { bank, name, number });
      ["#aBank", "#aName", "#aNum"].forEach(s => { box.querySelector(s).value = ""; });
      toast("success", "Saved", number);
      draw();
    } catch (err) {
      toast("error", "Could not save", "You may not have permission.");
    }
  };
};

showLoading("Loading payments...");
try {
  const snap = await get(query(ref(db, "payments"), orderByChild("createdAt"), limitToLast(200)));
  snap.forEach(c => { items.set(c.key, { id: c.key, ...c.val() }); });
} catch (e) {
  toast("error", "Could not load payments", "Check your internet and try again.");
}
render();
hideLoading();

onChildAdded(query(ref(db, "payments"), orderByChild("createdAt"), startAt(Date.now())), snap => {
  if (items.has(snap.key)) return;
  const o = { id: snap.key, ...snap.val() };
  items.set(o.id, o);
  render();
  toast("success", "New payment", o.name + " · " + naira(o.total), 9000);
});