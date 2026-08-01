import { NextResponse } from "next/server";
import { appendEntry, entriesSince } from "@/lib/attendanceStore";
import { requireAuth } from "@/lib/requireAuth";

const ID_REGEX = /^S20\d{8}$/;
const MAX_BATCH = 500;

// Called by the mobile app to reconcile its local SQLite queue with the
// server. Requires a valid staff session — unlike /api/attendance, there's
// no anonymous-kiosk use case for this endpoint.
//
//   POST { entries: [{ id, studentNumber, timestamp }, ...] }
//     -> upserts each by client-generated id (idempotent, safe to retry)
//     -> returns { acceptedIds, rejected }
//
//   GET ?since=<ISO timestamp>
//     -> entries the server has received since that point, so a device
//        can pick up attendance logged from OTHER devices too
//     -> returns { entries, serverTime }
export async function POST(request) {
  const { user, response } = requireAuth(request);
  if (response) return response;

  const body = await request.json().catch(() => null);
  const incoming = body && Array.isArray(body.entries) ? body.entries : null;
  if (!incoming) {
    return NextResponse.json({ error: "Expected { entries: [...] }." }, { status: 400 });
  }
  if (incoming.length > MAX_BATCH) {
    return NextResponse.json({ error: `Batch too large — max ${MAX_BATCH} entries per sync.` }, { status: 400 });
  }

  const acceptedIds = [];
  const rejected = [];

  for (const raw of incoming) {
    const studentNumber =
      raw && typeof raw.studentNumber === "string" ? raw.studentNumber.trim().toUpperCase() : "";
    const id = raw && typeof raw.id === "string" ? raw.id : null;

    if (!id || !ID_REGEX.test(studentNumber)) {
      rejected.push({ id: id || null, reason: "Invalid id or student number format." });
      continue;
    }

    const { entry } = appendEntry({
      id,
      studentNumber,
      timestamp: typeof raw.timestamp === "string" ? raw.timestamp : undefined,
      loggedBy: user.username,
      source: "mobile",
    });
    acceptedIds.push(entry.id);
  }

  return NextResponse.json({ acceptedIds, rejected });
}

export async function GET(request) {
  const { response } = requireAuth(request);
  if (response) return response;

  const since = new URL(request.url).searchParams.get("since") || null;
  const entries = entriesSince(since);
  return NextResponse.json({ entries, serverTime: new Date().toISOString() });
}
