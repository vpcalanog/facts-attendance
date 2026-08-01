import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/requireAuth";

export async function GET(request) {
  const { user, response } = requireAuth(request);
  if (response) return response;

  return NextResponse.json({
    user: { id: user.sub, username: user.username, name: user.name, role: user.role },
  });
}
