import { bindCode } from "./ui2.js";

const $ = id => document.getElementById(id);

const openHub = () => {
  $("codeBox").hidden = true;
  $("hub").hidden = false;
};

if (sessionStorage.getItem("hs_gate") === "1") {
  openHub();
} else {
  $("codeBox").hidden = false;
  bindCode($("code"), () => {
    sessionStorage.setItem("hs_gate", "1");
    openHub();
  });
}
