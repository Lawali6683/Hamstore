import { supabase, must } from "./supabase.js";
import { requireAdmin, accessToken } from "./guard.js";
import { toast, esc } from "./allui.js";
import { photoSlot, makeCode, codeKey, randomKey, plateKey, confirmLink, messageText, smsHref, mailHref, emailDriver } from "./ui2.js";
import { showLoading, hideLoading } from "./loading.js";

await requireAdmin("veh");

const $ = id => document.getElementById(id);
const PHONE = /^[0-9+\s-]{7,20}$/;
const slots = {
  driver: photoSlot($("sDriver"), { kind: "face", label: "Driver photo", optional: true }),
  plate: photoSlot($("sPlate"), { kind: "plate", label: "Plate number photo" }),
  vehicle: photoSlot($("sVehicle"), { kind: "vehicle", label: "Vehicle photo" }),
  id: photoSlot($("sId"), { kind: "id", label: "ID card photo", optional: true })
};

function resetForm() {
  $("form").reset();
  $("phone2Wrap").hidden = true;
  $("addPhone").hidden = false;
  Object.values(slots).forEach(s => s.clear());
}

$("open").onclick = () => {
  $("open").hidden = true;
  $("form").hidden = false;
  $("vName").focus();
};
$("cancel").onclick = () => {
  resetForm();
  $("form").hidden = true;
  $("open").hidden = false;
};
$("addPhone").onclick = () => {
  $("phone2Wrap").hidden = false;
  $("addPhone").hidden = true;
  $("dPhone2").focus();
};
$("rmPhone").onclick = () => {
  $("dPhone2").value = "";
  $("phone2Wrap").hidden = true;
  $("addPhone").hidden = false;
};

async function freshCode() {
  for (let i = 0; i < 8; i++) {
    const code = makeCode();
    const rows = must(await supabase.from("vehicles").select("id").eq("code_key", codeKey(code)).limit(1));
    if (!rows || !rows.length) return code;
  }
  throw new Error("code");
}

function showSuccess(v) {
  const text = messageText(v);
  const subject = "Your Hamstore vehicle ID " + v.code;
  const box = $("ok");
  box.innerHTML = `<div class="panel okcard">
    <button class="okx" type="button" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
    <div class="okmark"><i class="fa-solid fa-check"></i></div>
    <h3>Vehicle registered</h3>
    <p>${esc(v.name)} (${esc(v.plate)}) for ${esc(v.driverName)}. Send the ID and link to the driver.</p>
    <div class="bigcode">${esc(v.code)}</div>
    <div class="sendrow">
      <button class="btn sm" type="button" data-act="email"><i class="fa-solid fa-envelope-circle-check"></i>Send email</button>
      <a class="btn red sm" href="${smsHref(v.phone, text)}"><i class="fa-solid fa-message"></i>Send SMS</a>
      <a class="ghost sm" href="${mailHref(v.email, subject, text)}"><i class="fa-regular fa-envelope"></i>Open Gmail app</a>
      <button class="ghost sm" type="button" data-act="copy"><i class="fa-regular fa-copy"></i>Copy message</button>
    </div>
    <div class="sendrow" style="margin-top:10px"><button class="ghost sm" type="button" data-act="another"><i class="fa-solid fa-plus"></i>Register another vehicle</button></div>
  </div>`;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  box.querySelector(".okx").onclick = () => { box.innerHTML = ""; };
  box.onclick = async e => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "another") {
      box.innerHTML = "";
      $("form").hidden = false;
      $("open").hidden = true;
      $("vName").focus();
    }
    if (act === "copy") {
      try { await navigator.clipboard.writeText(text); toast("success", "Copied", "The message is on your clipboard."); }
      catch (err) { toast("error", "Copy failed", "Select the text and copy it by hand."); }
    }
    if (act === "email") {
      showLoading("Sending email...");
      try {
        const res = await emailDriver(await accessToken(), v);
        toast(res.ok ? "success" : "error", res.ok ? "Email sent" : "Email not sent", res.message);
      } catch (err) {
        toast("error", "Email not sent", "Check your internet and try again.");
      } finally {
        hideLoading();
      }
    }
  };
}

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const name = $("vName").value.trim();
  const driverName = $("dName").value.trim();
  const phone = $("dPhone").value.trim();
  const phone2 = $("phone2Wrap").hidden ? "" : $("dPhone2").value.trim();
  const plate = $("vPlate").value.trim().toUpperCase();
  const email = $("vEmail").value.trim().toLowerCase();
  if (name.length < 2) return toast("error", "Vehicle name", "Enter the vehicle name.");
  if (driverName.length < 2) return toast("error", "Driver name", "Enter the driver name.");
  if (!PHONE.test(phone)) return toast("error", "Phone number", "Enter a valid driver phone number.");
  if (phone2 && !PHONE.test(phone2)) return toast("error", "Second number", "Enter a valid second number or remove it.");
  if (plateKey(plate).length < 3) return toast("error", "Plate number", "Enter the plate number.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast("error", "Email", "Enter a valid email.");
  if (!slots.plate.has()) return toast("error", "Plate photo", "Take a photo of the plate number.");
  if (!slots.vehicle.has()) return toast("error", "Vehicle photo", "Take a photo of the vehicle.");

  showLoading("Checking plate number...");
  try {
    const pk = plateKey(plate);
    const dup = must(await supabase.from("vehicles").select("id").eq("plate_key", pk).limit(1));
    if (dup && dup.length) {
      hideLoading();
      return toast("error", "Already registered", "This plate number is already in the system.");
    }
    hideLoading();
    showLoading("Uploading photos...");
    const [driverPhoto, platePhoto, vehiclePhoto, idPhoto] = await Promise.all([slots.driver.upload(), slots.plate.upload(), slots.vehicle.upload(), slots.id.upload()]);
    hideLoading();
    showLoading("Saving...");
    const photos = { plate: platePhoto, vehicle: vehiclePhoto };
    if (driverPhoto) photos.driver = driverPhoto;
    if (idPhoto) photos.id = idPhoto;

    let saved = null;
    let code = "";
    let key = "";
    for (let i = 0; i < 5 && !saved; i++) {
      code = await freshCode();
      key = randomKey();
      const { data, error } = await supabase.from("vehicles").insert({
        code, code_key: codeKey(code), key, name, driver_name: driverName,
        phone, phone2: phone2 || null, plate, plate_key: pk, email, photos
      }).select("id").single();
      if (!error) { saved = data; break; }
      if (error.code === "23505" && String(error.message + error.details).includes("plate_key")) {
        hideLoading();
        return toast("error", "Already registered", "This plate number is already in the system.");
      }
      if (error.code !== "23505") throw error;
    }
    if (!saved) throw new Error("code");

    const rec = { name, driverName, phone, plate, email, code, key, createdAt: Date.now(), photos };
    if (phone2) rec.phone2 = phone2;
    resetForm();
    toast("success", "Vehicle registered", code);
    showSuccess({ ...rec, id: saved.id, link: confirmLink(code, key) });
  } catch (err) {
    toast("error", "Could not register", err.message === "upload" ? "Photo upload failed. Try again." : "You may not have permission, or the connection failed.");
  } finally {
    hideLoading();
  }
});
