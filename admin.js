import { bindCode } from "./ui2.js";

const $ = id => document.getElementById(id);

if (sessionStorage.getItem("hs_gate") !== "1") {
  $("codeBox").hidden = false;
  bindCode($("code"), () => {
    sessionStorage.setItem("hs_gate", "1");
    location.replace("admin.html");
  });
} else {
  const { requireAdmin } = await import("./guard.js");
  await requireAdmin("home");
  $("hub").hidden = false;
}