import { app } from "./firebase.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getDatabase, ref, get, update } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";
import { requireAdmin } from "./guard.js";
import { toast, confirmBox, esc, ago } from "./allui.js";
import { DEFAULT_MESSAGE, messageText, smsHref, mailHref, emailDriver, confirmLink, codeKey, plateKey } from "./ui2.js";
import { showLoading, hideLoading } from "./loading.js";

const auth = getAuth(app);
const db = getDatabase(app);
await requireAdmin("send");

const $ = id => document.getElementById(id);
const vehicles = new Map();

function template() {
  try { return localStorage.getItem("hs_msg") || DEFAULT_MESSAGE; } catch (e) { return DEFAULT_MESSAGE; }
}
$("tpl").value = template();

$("saveTpl").onclick = () => {
  try { localStorage.setItem("hs_msg", $("tpl").value.trim() || DEFAULT_MESSAGE); } catch (e) {}
  toast("success", "Saved", "The message was saved on this device.");
  render();
};
$("resetTpl").onclick = () => {
  try { localStorage.removeItem("hs_msg"); } catch (e) {}
  $("tpl").value = DEFAULT_MESSAGE;
  render();
};

const withLink = v => ({ ...v, link: v.code ? confirmLink(v.code, v.key) : "" });

function rowHTML(raw) {
  const v = withLink(raw);
  const photo = (v.photos && (v.photos.vehicle || v.photos.driver)) || "";
  const canSend = !!v.code && !!v.link;
  const text = canSend ? messageText(v, $("tpl").value) : "";
  const subject = "Your Hamstore vehicle ID " + v.code;
  return `<article class="panel vrow" data-id="${esc(v.id)}">
    ${photo ? `<img loading="lazy" decoding="async" src="${esc(photo)}" alt="">` : '<div class="noimg"><i class="fa-solid fa-truck"></i></div>'}
    <div>
      <h4>${esc(v.name)} <span class="meta">${esc(v.plate)}</span></h4>
      <p class="meta">${v.driverName ? esc(v.driverName) + " · " : ""}${esc(v.phone || "No phone")}${v.email ? " · " + esc(v.email) : ""}</p>
      <div class="tags" style="margin-top:6px">
        ${v.code ? `<span class="chipc">${esc(v.code)}</span>` : '<span class="chipc">Old record</span>'}
        ${v.confirmedAt ? `<span class="chipc ok"><i class="fa-solid fa-circle-check"></i>Confirmed ${ago(v.confirmedAt)}</span>` : '<span class="chipc wait"><i class="fa-regular fa-clock"></i>Waiting</span>'}
      </div>
    </div>
    <div class="acts2">
      ${canSend && v.email ? '<button class="btn sm" type="button" data-act="email"><i class="fa-solid fa-envelope-circle-check"></i>Email</button>' : ""}
      ${canSend && v.phone ? `<a class="btn red sm" href="${smsHref(v.phone, text)}"><i class="fa-solid fa-message"></i>SMS</a>` : ""}
      ${canSend && v.email ? `<a class="ghost sm" href="${mailHref(v.email, subject, text)}"><i class="fa-regular fa-envelope"></i>Gmail app</a>` : ""}
      ${canSend ? '<button class="ghost sm" type="button" data-act="copy"><i class="fa-regular fa-copy"></i>Copy</button>' : ""}
      <button class="ibtn del" type="button" data-act="del" aria-label="Delete"><i class="fa-solid fa-trash"></i></button>
    </div></article>`;
}

function render() {
  const q = $("search").value.trim().toLowerCase();
  const list = [...vehicles.values()]
    .filter(v => !q || [v.name, v.plate, v.driverName, v.code, v.phone].some(x => String(x || "").toLowerCase().includes(q)))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  $("list").innerHTML = list.map(rowHTML).join("");
  $("count").textContent = vehicles.size;
  $("empty").hidden = vehicles.size > 0;
}
$("search").addEventListener("input", render);

$("list").addEventListener("click", async e => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.closest(".vrow").dataset.id;
  const v = withLink(vehicles.get(id));
  if (btn.dataset.act === "copy") {
    try { await navigator.clipboard.writeText(messageText(v, $("tpl").value)); toast("success", "Copied", "The message is on your clipboard."); }
    catch (err) { toast("error", "Copy failed", "Select the text and copy it by hand."); }
  }
  if (btn.dataset.act === "email") {
    showLoading("Sending email...");
    try {
      const res = await emailDriver(await auth.currentUser.getIdToken(), v);
      toast(res.ok ? "success" : "error", res.ok ? "Email sent" : "Email not sent", res.message);
    } catch (err) {
      toast("error", "Email not sent", "Check your internet and try again.");
    } finally {
      hideLoading();
    }
  }
  if (btn.dataset.act === "del") {
    if (!(await confirmBox({ title: "Delete this vehicle?", text: "Its ID, tracking and route history will be removed.", okText: "Delete", danger: true }))) return;
    showLoading("Deleting...");
    try {
      const paths = { ["vehicles/" + id]: null, ["tracking/" + id]: null, ["trails/" + id]: null };
      if (v.code) paths["codes/" + codeKey(v.code)] = null;
      if (v.plate) paths["plates/" + plateKey(v.plate)] = null;
      await update(ref(db), paths);
      vehicles.delete(id);
      render();
      toast("success", "Deleted", id + " was removed.");
    } catch (err) {
      toast("error", "Could not delete", "You may not have permission.");
    } finally {
      hideLoading();
    }
  }
});

showLoading("Loading vehicles...");
try {
  const snap = await get(ref(db, "vehicles"));
  snap.forEach(c => { vehicles.set(c.key, { id: c.key, ...c.val() }); });
} catch (e) {
  toast("error", "Could not load vehicles", "Check your internet and try again.");
}
render();
hideLoading();