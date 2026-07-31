//api/students/route
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Reads lib/students.csv (columns: StudentNo, Student Name, Course, Year Level)
// and serves it as { students: [{ studentNumber, name, course, yearLevel }] }.
// This is the roster page.js already looks up via /api/students — it just
// didn't have a backing route yet.
//
// Override the path with STUDENTS_CSV_PATH if your file lives somewhere else
// or is named differently.
const CSV_PATH =
  process.env.STUDENTS_CSV_PATH || path.join(process.cwd(), "lib", "students.csv");

// Simple RFC4180-ish CSV parser: handles quoted fields, embedded commas,
// escaped quotes (""), and \r\n or \n line endings. Good enough for a
// roster export out of Excel/Sheets without pulling in a dependency.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // last field/row (file may or may not end with a newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// Matches header variants like "StudentNo", "Student No", "student_number",
// "Student Name", "Year Level", "YearLevel" etc.
function normalizeHeader(h) {
  return (h || "").trim().toLowerCase().replace(/[^a-z]/g, "");
}

const HEADER_ALIASES = {
  studentno: "studentNumber",
  studentnumber: "studentNumber",
  studentid: "studentNumber",
  studentname: "name",
  name: "name",
  course: "course",
  yearlevel: "yearLevel",
  year: "yearLevel",
};

function normalizeStudentNumber(str) {
  return (str || "").toUpperCase().trim().replace(/\s+/g, "");
}

function loadRoster() {
  let raw;
  try {
    raw = fs.readFileSync(CSV_PATH, "utf-8");
  } catch {
    return { students: [], error: `Could not read ${CSV_PATH}` };
  }

  const rows = parseCsv(raw);
  if (rows.length === 0) return { students: [] };

  const headerRow = rows[0].map(normalizeHeader);
  const keys = headerRow.map((h) => HEADER_ALIASES[h] || null);

  const students = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const record = {};
    for (let c = 0; c < keys.length; c++) {
      const key = keys[c];
      if (!key) continue;
      record[key] = (cells[c] || "").trim();
    }
    if (!record.studentNumber) continue;
    students.push({
      studentNumber: normalizeStudentNumber(record.studentNumber),
      name: record.name || "",
      course: record.course || "",
      yearLevel: record.yearLevel || "",
    });
  }

  return { students };
}

export async function GET() {
  const { students, error } = loadRoster();
  if (error) {
    // Don't fail the whole request — page.js just shows "not in roster"
    // if the list is empty, which is a reasonable fallback.
    return NextResponse.json({ students: [], error }, { status: 200 });
  }
  return NextResponse.json({ students });
}