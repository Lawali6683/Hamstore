import { bindCode } from "./ui2.js";

const $ = id => document.getElementById(id);

const showCode = () => {
  $("hub").hidden = true;
  $("hub").style.display = "none";
  $("codeBox").hidden = false;
  $("codeBox").style.display = "";
};

const openHub = () => {
  $("codeBox").hidden = true;
  $("codeBox").style.display = "none";
  $("hub").hidden = false;
  $("hub").style.display = "";
  window.scrollTo(0, 0);
};

if (sessionStorage.getItem("hs_gate") === "1") {
  openHub();
} else {
  showCode();
  bindCode($("code"), () => {
    sessionStorage.setItem("hs_gate", "1");
    openHub();
  });
}
