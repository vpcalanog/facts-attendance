import fs from "fs";
import path from "path";

// Shared JSON-file-backed store for events, mirroring attendanceStore.js.
// Same "single server / self-hosted deployment" caveat applies — swap for
// a real database before deploying somewhere with a read-only or
// ephemeral filesystem (e.g. Vercel's default runtime).
const DATA_DIR = process.env.ATTENDANCE_DATA_DIR || path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "events.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
}

export function readEvents() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeEvents(events) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(events, null, 2), "utf-8");
}

// Always assigns a fresh server id, distinct from whatever temp id the
// offline client used locally — the client reconciles the two using the
// `tempId` echoed back from /api/events/sync.
export function createEvent({ name, description, startsAt, courses, yearLevels, createdBy }) {
  const events = readEvents();
  const now = new Date().toISOString();
  const event = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name,
    description: description || null,
    startsAt: startsAt || null,
    courses: Array.isArray(courses) ? courses : [],
    yearLevels: Array.isArray(yearLevels) ? yearLevels : [],
    createdBy: createdBy || null,
    updatedAt: now,
    createdAt: now,
  };
  events.push(event);
  writeEvents(events);
  return event;
}

export function allEvents() {
  return readEvents();
}

export function eventExists(id) {
  return readEvents().some((e) => e.id === id);
}
