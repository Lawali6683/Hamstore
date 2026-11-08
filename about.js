const KEY = "hs_lang";

function browserLang() {
  return (navigator.language || "").toLowerCase().startsWith("ha") ? "ha" : "en";
}

function apply(l) {
  document.documentElement.setAttribute("data-lang", l);
  document.documentElement.lang = l;
  document.body.setAttribute("data-lang", l);
  document.querySelectorAll("[data-lang-btn]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.langBtn === l)));
  const sw = document.getElementById("langSw");
  if (sw) sw.dataset.on = l;
  try { localStorage.setItem(KEY, l); } catch (e) {}
}

let start = browserLang();
try { start = localStorage.getItem(KEY) || start; } catch (e) {}
document.querySelectorAll("[data-lang-btn]").forEach(b => b.addEventListener("click", () => apply(b.dataset.langBtn)));
apply(start);
