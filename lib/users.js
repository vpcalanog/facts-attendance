import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";

// Same single-server caveat as attendance.json — swap for a real database
// before deploying to a serverless platform with an ephemeral filesystem.
const DATA_DIR = process.env.ATTENDANCE_DATA_DIR || path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]", "utf-8");
}

function readUsers() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  ensureStore();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

export function findUserByUsername(username) {
  const users = readUsers();
  return users.find((u) => u.username.toLowerCase() === String(username || "").toLowerCase()) || null;
}

export async function verifyPassword(user, password) {
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}

export async function createUser({ username, password, name, role }) {
  const users = readUsers();
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("Username already exists.");
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    username,
    passwordHash,
    name: name || username,
    role: role || "staff",
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);
  return user;
}

// Strips the password hash before a user object is ever sent to a client.
export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, name: u.name, role: u.role };
}
