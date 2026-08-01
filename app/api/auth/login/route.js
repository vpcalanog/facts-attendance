import { NextResponse } from "next/server";
import { findUserByUsername, verifyPassword, publicUser } from "@/lib/users";
import { signToken } from "@/lib/token";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const username = body && typeof body.username === "string" ? body.username.trim() : "";
  const password = body && typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }

  const user = findUserByUsername(username);
  const ok = await verifyPassword(user, password);
  if (!ok) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const token = signToken({ sub: user.id, username: user.username, name: user.name, role: user.role });
  return NextResponse.json({ token, user: publicUser(user) });
}
