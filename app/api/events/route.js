import { NextResponse } from "next/server";
import { allEvents } from "@/lib/eventsStore";
import { requireAuth } from "@/lib/requireAuth";

// Called by the mobile app's roster-style pull sync — returns every event
// so the client can cache them locally and list them under the Events
// tab. Requires a valid staff session, same as the roster and attendance
// endpoints. Any staff member (not just admins) can read this; only
// creation is admin-gated, in /api/events/sync.
export async function GET(request) {
  const { response } = requireAuth(request);
  if (response) return response;

  const events = allEvents();
  return NextResponse.json({ events });
}
