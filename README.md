# FACTS Attendance

Mobile-first ID-scan attendance system for the Faith Computer Technology Society, built with Next.js (App Router).

Scan a student ID with the camera, OCR pulls out the student number (format `S20XXXXXXXX` — "S20" + 8 digits), you confirm it, and it's logged with a timestamp to a shared server-side log.

## Run it locally

```bash
npm install
npm run dev
```

Visit `http://localhost:3000` on the same computer — the camera works fine there.

## ⚠️ Getting it onto phones: read this first

Browsers only allow camera access (`getUserMedia`) on a **secure context** — that's `https://` or `localhost`. A phone visiting your computer's local IP over plain `http://` (e.g. `http://192.168.1.23:3000`) will **not** be allowed to open the camera, even though everything else works. You have two good options:

**Option A — Deploy it (recommended, easiest for real use)**
Push this to GitHub and deploy to [Vercel](https://vercel.com) (free tier is fine). Vercel gives you HTTPS automatically, and any phone can open the URL from anywhere.
```bash
npm i -g vercel
vercel
```
See the persistence note below before you do this, though.

**Option B — Test on your phone over your local network with HTTPS**
Use a tunnel like `ngrok` or Tailscale Funnel to get a temporary HTTPS URL pointed at your local dev server:
```bash
npm run dev
npx ngrok http 3000
```
Open the `https://...ngrok...` URL it gives you on your phone.

Running `next dev -H 0.0.0.0` (already set as the `dev` script) makes the server reachable on your LAN, but again — without HTTPS the phone's browser will block the camera.

## ⚠️ Data persistence note

The attendance log is stored in `data/attendance.json` on the server's disk via the `/api/attendance` route. This works well for:
- Running on your own machine or a small VPS
- Any host with a normal, persistent filesystem

It will **not** persist on serverless platforms with ephemeral/read-only filesystems (Vercel's default Node runtime resets the filesystem between deploys and across instances). If you deploy there and need the log to actually stick, swap `readEntries`/`writeEntries` in `app/api/attendance/route.js` for a real database — Vercel Postgres, Supabase, Vercel KV, etc. all work with a small change to those two functions.

## Project structure

```
app/
  layout.js              # fonts, metadata, mobile viewport
  globals.css            # FACTS red/black theme
  page.js                # camera capture, OCR, log UI (client component)
  api/attendance/route.js # GET/POST attendance entries (JSON file store)
lib/
  extract.js             # student-number regex + validation
  format.js               # relative/absolute timestamp formatting
components/
  Icons.js               # inline SVG icon set
public/
  facts-logo.png          # your uploaded logo
data/
  attendance.json         # created automatically on first scan
```

## Notes on OCR accuracy

Tesseract.js runs entirely in the browser (no server round-trip, no data leaves the device until you confirm a log). Accuracy depends a lot on lighting, glare, and the ID's font — that's why the app always shows the detected number in an editable field before saving, and offers a manual-entry fallback. Test it against your actual ID card design before relying on it for real attendance tracking.
