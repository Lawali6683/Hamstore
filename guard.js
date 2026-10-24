import { supabase, isAdmin } from "./supabase.js";


const LOGIN_PAGE = "gate.html";

const stop = () => new Promise(() => {}); // yana dakatar da sauran file din bayan redirect

export async function requireAdmin(page) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    location.replace(LOGIN_PAGE);
    await stop();
  }
  if (!(await isAdmin())) {
    await supabase.auth.signOut();
    location.replace(LOGIN_PAGE);
    await stop();
  }
  supabase.auth.onAuthStateChange(event => {
    if (event === "SIGNED_OUT") location.replace(LOGIN_PAGE);
  });
  return data.session;
}

export async function accessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session ? data.session.access_token : "";
}
