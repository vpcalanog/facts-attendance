#!/usr/bin/env node
// Creates a staff/admin account for the mobile app's login screen.
// Run from your Next.js project root:
//   node scripts/create-admin-user.mjs <username> <password> ["Full Name"] [role]
//
// Example:
//   node scripts/create-admin-user.mjs jsantos "correct horse battery staple" "Juan Santos" admin
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";

const DATA_DIR = process.env.ATTENDANCE_DATA_DIR || path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function readUsers() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

async function main() {
  const [, , username, password, name, role] = process.argv;
  if (!username || !password) {
    console.error('Usage: node scripts/create-admin-user.mjs <username> <password> ["Full Name"] [role]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password should be at least 8 characters.");
    process.exit(1);
  }

  const users = readUsers();
  if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
    console.error(`A user named "${username}" already exists. Edit or remove them in data/users.json first.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  users.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    username,
    passwordHash,
    name: name || username,
    role: role || "staff",
    createdAt: new Date().toISOString(),
  });
  writeUsers(users);
  console.log(`Created user "${username}" (${role || "staff"}). They can now log in from the mobile app.`);
}

main();
