import fs from "fs";
import path from "path";

// Shared JSON-file-backed store for attendance entries. Same "single
// server / self-hosted deployment" caveat as before — swap for a real
// database (Postgres, Supabase, etc.) before deploying somewhere with a
// read-only or ephemeral filesystem (e.g. Vercel's default runtime).
const DATA_DIR = process.env.ATTENDANCE_DATA_DIR || path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "attendance.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
}

export function readEntries() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeEntries(entries) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

// Adds an entry. If `id` is supplied and already exists, the existing
// entry is returned untouched instead of duplicated — this makes it safe
// for an offline client to retry the same sync batch after a dropped
// connection without creating duplicate log lines.
//
// `eventId` is optional at the store level: the mobile app always sends
// one now, but this store is also written to by other sources (see
// `source` below) that may not have an event concept, so we don't want a
// missing eventId to reject an otherwise-valid entry.
export function appendEntry({ id, studentNumber, eventId, timestamp, loggedBy, source }) {
  const entries = readEntries();
  const entryId = id || Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const existing = entries.find((e) => e.id === entryId);
  if (existing) return { entry: existing, created: false };

  const entry = {
    id: entryId,
    studentNumber,
    eventId: eventId || null,
    timestamp: timestamp || new Date().toISOString(),
    loggedBy: loggedBy || null,
    source: source || "web",
    // When the SERVER actually received this entry — distinct from
    // `timestamp`, which is the client's (possibly offline, possibly old)
    // scan time. Delta sync pulls key off this field.
    receivedAt: new Date().toISOString(),
  };
  entries.push(entry);
  writeEntries(entries);
  return { entry, created: true };
}

// Entries the server received at or after `isoTimestamp` — used for delta
// pulls so a device can pick up entries logged from OTHER devices.
export function entriesSince(isoTimestamp) {
  const entries = readEntries();
  if (!isoTimestamp) return entries;
  const cutoff = new Date(isoTimestamp).getTime();
  if (Number.isNaN(cutoff)) return entries;
  return entries.filter((e) => new Date(e.receivedAt || e.timestamp).getTime() >= cutoff);
}
