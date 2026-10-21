const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

const NORTH = ["kano", "katsina", "kaduna", "sokoto", "zamfara", "kebbi", "jigawa", "bauchi", "gombe", "yobe", "borno", "niger"];

export async function onRequestGet({ request }) {
  const cf = request.cf || {};
  const region = String(cf.region || "").toLowerCase();
  const country = String(cf.country || "");
  let lang = "en";
  if (country === "NE") lang = "ha";
  else if (country === "NG" && NORTH.some(n => region.includes(n))) lang = "ha";
  return reply({ lang, country, region: cf.region || "" });
}