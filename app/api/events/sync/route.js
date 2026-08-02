import { NextResponse } from "next/server";
import { createEvent } from "@/lib/eventsStore";
import { requireAuth } from "@/lib/requireAuth";

const MAX_BATCH = 50;

// Called by the mobile app to push events created offline (by an admin)
// up to the server. The server always assigns the real id — `tempId`
// lets the client swap out its local placeholder row for the
// server-authoritative version once accepted.
//
//   POST { events: [{ id: "<tempId>", name, courses, yearLevels, ... }] }
//     -> { accepted: [{ tempId, event }], rejected: [{ tempId, reason }] }
export async function POST(request) {
  const { user, response } = requireAuth(request);
  if (response) return response;

  // The mobile app only HIDES the "New event" button for non-admins —
  // that's a UI convenience, not enforcement. This is the actual check.
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can create events." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const incoming = body && Array.isArray(body.events) ? body.events : null;
  if (!incoming) {
    return NextResponse.json({ error: "Expected { events: [...] }." }, { status: 400 });
  }
  if (incoming.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Batch too large — max ${MAX_BATCH} events per sync.` },
      { status: 400 }
    );
  }

  const accepted = [];
  const rejected = [];

  for (const raw of incoming) {
    const tempId = raw && typeof raw.id === "string" ? raw.id : null;
    const name = raw && typeof raw.name === "string" ? raw.name.trim() : "";

    if (!tempId || !name) {
      rejected.push({ tempId: tempId || null, reason: "Missing id or name." });
      continue;
    }

    const event = createEvent({
      name,
      description: typeof raw.description === "string" ? raw.description : null,
      startsAt: typeof raw.startsAt === "string" ? raw.startsAt : null,
      courses: Array.isArray(raw.courses) ? raw.courses : [],
      yearLevels: Array.isArray(raw.yearLevels) ? raw.yearLevels : [],
      createdBy: user.username,
    });
    accepted.push({ tempId, event });
  }

  return NextResponse.json({ accepted, rejected });
}
