const LOGO = "https://i.imgur.com/UXH5q5w.png";

const css = `
#hsLoader{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(5,14,10,.94);backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity .25s}
#hsLoader.on{opacity:1;pointer-events:auto}
#hsLoader .box{display:grid;justify-items:center;gap:20px;padding:20px}
#hsLoader img{display:block;height:84px;width:auto;max-width:78vw;animation:hsPulse 1.6s ease-in-out infinite}
#hsLoader .track{width:150px;height:4px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}
#hsLoader .track i{display:block;height:100%;width:40%;border-radius:4px;background:linear-gradient(90deg,#e03a3a,#2fb36d);animation:hsSlide 1.1s ease-in-out infinite}
#hsLoader p{margin:0;color:#cfe8da;font:500 14px system-ui,sans-serif}
@keyframes hsPulse{50%{transform:scale(1.05);opacity:.85}}
@keyframes hsSlide{0%{transform:translateX(-100%)}100%{transform:translateX(375%)}}
@media (prefers-reduced-motion:reduce){#hsLoader img,#hsLoader .track i{animation-duration:4s}}
`;

let el = null;
let label = null;
let count = 0;

function build() {
  if (el) return;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  el = document.createElement("div");
  el.id = "hsLoader";
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="box"><img src="${LOGO}" alt="Hamstore"><div class="track"><i></i></div><p></p></div>`;
  label = el.querySelector("p");
  document.body.appendChild(el);
}

export function showLoading(text = "Loading...") {
  build();
  count++;
  label.textContent = text;
  requestAnimationFrame(() => el.classList.add("on"));
}

export function hideLoading() {
  if (!el) return;
  count = Math.max(0, count - 1);
  if (count === 0) el.classList.remove("on");
}