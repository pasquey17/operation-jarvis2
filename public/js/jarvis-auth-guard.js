/** Side-effect: redirect to login when there is no Supabase session. */
import {
  apiFetch,
  getAuthUserId,
  getAuthEmail,
  signOut,
  requireAuthPage,
} from "./jarvis-auth.js";
import { initJarvisSettings } from "./jarvis-settings.js";

await requireAuthPage();
await initJarvisSettings();

/** Legacy inline scripts on journal/analytics pages. */
window.JarvisAuth = {
  fetch: apiFetch,
  getUserId: getAuthUserId,
  getEmail: getAuthEmail,
  signOut,
};
