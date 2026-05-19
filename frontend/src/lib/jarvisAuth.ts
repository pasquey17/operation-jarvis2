import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://oiyyrpfphefswaesddgw.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9peXlycGZwaGVmc3dhZXNkZGd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NTk3MDcsImV4cCI6MjA5MzQzNTcwN30.6ERf70bg6joKI66HKOl9vUyKekDonf-_bLPR8_9fTs4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function requireAuthSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    window.location.replace("/login.html?next=" + encodeURIComponent(window.location.pathname));
    return null;
  }
  return data.session;
}

export async function getAuthUserId() {
  const session = await requireAuthSession();
  return session?.user?.id ?? null;
}

export async function apiFetch(url: string, options: RequestInit = {}) {
  const session = await requireAuthSession();
  if (!session) throw new Error("Not signed in");
  const headers = new Headers(options.headers);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  return fetch(url, { ...options, headers, cache: "no-store" });
}
