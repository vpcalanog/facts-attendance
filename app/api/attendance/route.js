import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// NOTE: this uses a JSON file on the server's local disk, which is enough
// for a single-server / self-hosted deployment (e.g. a school's own machine
// or a small VPS). It will NOT persist on serverless platforms with
// read-only or ephemeral filesystems (e.g. Vercel's default runtime) —
// swap readEntries/writeEntries for a real database (Postgres, Supabase,
// Vercel KV, etc.) before deploying there.
const DATA_DIR = process.env.ATTENDANCE_DATA_DIR || path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "attendance.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
}

function readEntries() {
  ensureStore();
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEntries(entries) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

const ID_REGEX = /^S20\d{8}$/;

export async function GET() {
  const entries = readEntries();
  return NextResponse.json({ entries });
}

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const studentNumber =
    body && typeof body.studentNumber === "string" ? body.studentNumber.trim().toUpperCase() : "";

  if (!ID_REGEX.test(studentNumber)) {
    return NextResponse.json(
      { error: "Invalid student number format. Expected S20 followed by 8 digits." },
      { status: 400 }
    );
  }

  const entries = readEntries();
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    studentNumber,
    timestamp: new Date().toISOString(),
  };
  entries.push(entry);
  writeEntries(entries);

  return NextResponse.json({ entry }, { status: 201 });
}
