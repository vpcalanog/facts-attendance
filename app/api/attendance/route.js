import { NextResponse } from "next/server";
import { readEntries, appendEntry } from "@/lib/attendanceStore";
import { getAuthUser } from "@/lib/requireAuth";

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

  // Auth is OPTIONAL here on purpose: the web kiosk (unauthenticated)
  // keeps working exactly as before. The mobile app sends a Bearer token,
  // which — if valid — gets attached so the entry shows who logged it.
  // If you want to lock this endpoint down to staff-only entirely, swap
  // this for requireAuth(request) and return early on `response`.
  const authUser = getAuthUser(request);

  const { entry } = appendEntry({
    studentNumber,
    loggedBy: authUser ? authUser.username : null,
    source: authUser ? "mobile" : "web",
  });

  return NextResponse.json({ entry }, { status: 201 });
}
