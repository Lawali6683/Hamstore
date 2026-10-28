import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

export const SUPABASE_URL = "https://eqbrczrlxwffvizjcdvu.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_xVqoz6timvYpD9t4v0j4Wg_InNafy34";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});


export function must(res) {
  if (res.error) throw res.error;
  return res.data;
}


export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session || null;
}

export async function isAdmin() {
  const { data, error } = await supabase.rpc("is_admin");
  return !error && data === true;
}
