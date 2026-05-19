/** Side-effect: redirect to login when there is no Supabase session. */
import {
  apiFetch,
  getAuthUserId,
  getAuthEmail,
  signOut,
  requireAuthPage,
  initNavAuthUi,
} from "./jarvis-auth.js";

await requireAuthPage();
await initNavAuthUi();

/** Legacy inline scripts on journal/analytics pages. */
window.JarvisAuth = {
  fetch: apiFetch,
  getUserId: getAuthUserId,
  getEmail: getAuthEmail,
  signOut,
};
