import { NextResponse } from "next/server";
import { verifyToken } from "./token";

// Returns the decoded token payload ({ sub, username, name, role, ... })
// or null — never throws, safe to call unconditionally.
export function getAuthUser(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  return verifyToken(token);
}

// Use in routes that must be authenticated. Usage:
//   const { user, response } = requireAuth(request);
//   if (response) return response;
export function requireAuth(request) {
  const user = getAuthUser(request);
  if (!user) {
    return { user: null, response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }) };
  }
  return { user, response: null };
}
