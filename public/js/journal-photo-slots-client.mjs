/**
 * Per-user photo slot templates for LOG TRADE (Supabase + localStorage fallback).
 */

export const AIDEN_USER_ID = "aidenpasque11@gmail.com";

export const AIDEN_DEFAULT_PHOTO_SLOTS = [
  { slot_id: "htf", label: "HTF", display_order: 0 },
  { slot_id: "ltf", label: "LTF", display_order: 1 },
  { slot_id: "entry", label: "Entry", display_order: 2 },
];

const PHOTO_SLOTS_LS_PREFIX = "jarvis_photo_slots_v1_";

export function photoSlotsStorageKey(userId) {
  return `${PHOTO_SLOTS_LS_PREFIX}${String(userId || "")
    .trim()
    .toLowerCase()}`;
}

/** First-time defaults: Aiden → HTF/LTF/Entry; everyone else → none (user adds slots). */
export function getDefaultPhotoSlotsForUser(userId) {
  const id = String(userId || "").trim().toLowerCase();
  if (id === AIDEN_USER_ID) return AIDEN_DEFAULT_PHOTO_SLOTS.map((s) => ({ ...s }));
  return [];
}

export function normalizePhotoSlot(row) {
  const slot_id = String(row?.slot_id || row?.id || "").trim();
  const label = String(row?.label || "").trim();
  if (!slot_id || !label) return null;
  return {
    slot_id,
    label,
    display_order: Number(row?.display_order) || 0,
  };
}

export function sortPhotoSlots(slots) {
  return [...slots].sort(
    (a, b) => (a.display_order || 0) - (b.display_order || 0) || a.label.localeCompare(b.label)
  );
}

export function loadPhotoSlotsFromLocal(userId) {
  try {
    const raw = JSON.parse(localStorage.getItem(photoSlotsStorageKey(userId)) || "null");
    if (!Array.isArray(raw)) return null;
    return sortPhotoSlots(raw.map(normalizePhotoSlot).filter(Boolean));
  } catch {
    return null;
  }
}

export function savePhotoSlotsToLocal(userId, slots) {
  try {
    localStorage.setItem(photoSlotsStorageKey(userId), JSON.stringify(sortPhotoSlots(slots)));
  } catch {}
}

export function makePhotoSlotId() {
  return `slot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function fetchPhotoSlotsFromApi(userId) {
  const q = new URLSearchParams({ user_id: `eq.${userId}` });
  const res = await fetch(`/api/journal-photo-slots?${q.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    const err = new Error(`Photo slots fetch failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  const rows = Array.isArray(data.slots) ? data.slots : [];
  return sortPhotoSlots(rows.map(normalizePhotoSlot).filter(Boolean));
}

export async function savePhotoSlotsToApi(userId, slots) {
  const res = await fetch("/api/journal-photo-slots", {
    method: "PATCH",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, slots: sortPhotoSlots(slots) }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `Photo slots save failed (${res.status})`);
  }
  const data = await res.json().catch(() => ({}));
  const rows = Array.isArray(data.slots) ? data.slots : slots;
  return sortPhotoSlots(rows.map(normalizePhotoSlot).filter(Boolean));
}

/**
 * Load slots: API → localStorage → seeded defaults (persist when possible).
 */
export async function loadPhotoSlotsForUser(userId) {
  const uid = String(userId || "").trim();
  if (!uid) return [];

  try {
    const fromApi = await fetchPhotoSlotsFromApi(uid);
    if (fromApi.length) {
      savePhotoSlotsToLocal(uid, fromApi);
      return fromApi;
    }
  } catch (e) {
    if (e?.status !== 404 && typeof console !== "undefined") {
      console.warn("[log-trade] Photo slots API:", e?.message || e);
    }
  }

  const fromLocal = loadPhotoSlotsFromLocal(uid);
  if (fromLocal?.length) return fromLocal;

  const defaults = getDefaultPhotoSlotsForUser(uid);
  if (!defaults.length) return [];

  savePhotoSlotsToLocal(uid, defaults);
  try {
    return await savePhotoSlotsToApi(uid, defaults);
  } catch {
    return defaults;
  }
}

export async function persistPhotoSlotsForUser(userId, slots) {
  const uid = String(userId || "").trim();
  const sorted = sortPhotoSlots(slots.map(normalizePhotoSlot).filter(Boolean));
  savePhotoSlotsToLocal(uid, sorted);
  try {
    return await savePhotoSlotsToApi(uid, sorted);
  } catch (e) {
    if (typeof console !== "undefined") console.warn("[log-trade] Photo slots save:", e?.message || e);
    return sorted;
  }
}
