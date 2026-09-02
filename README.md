# BP4me

A blood pressure logger that reads your digital monitor's screen with visual AI.

Snap a photo of the monitor, and BP4me reads **SYS / DIA / PUL** off the display,
lets you confirm or correct the numbers, and logs them with the date and time.
It shows trends and statistics, and produces a PDF report for any period that
you can email to your physician.

## Features

- **Photo reading** — the camera photo is sent to a Cloudflare Worker, which asks
  Gemini (vision) for the systolic, diastolic and pulse values. The values are
  pre-filled in the form with a confidence indicator; you always confirm before
  saving. Manual entry works without the vision service.
- **Log** — date/time (defaults to now), arm, free-text note, automatic ACC/AHA
  category (Normal, Elevated, Stage 1, Stage 2, Crisis) and irregular-heartbeat flag.
- **History** — filter by period, edit or delete any reading.
- **Trends** — averages, min/max, share of readings in the normal range, morning vs
  evening breakdown, systolic/diastolic and pulse charts with threshold lines.
- **Report** — pick a date range, download a PDF (summary, chart, full table),
  print, or open a pre-filled email to your physician and attach the PDF.
- **Cloud storage with offline cache** — readings are stored per user in a
  Cloudflare D1 database and cached in the browser (localStorage), so the app
  works offline and the same history shows on every device. Changes made
  offline are queued and uploaded when the connection returns; conflicts
  resolve per reading by last write, and deletions propagate everywhere.
  Export and import JSON, or export CSV, from Settings. Photos are sent to the
  vision API for reading and are not stored anywhere. The profile (name,
  physician) stays in the browser.
- **Installable** — a web-app manifest lets you add BP4me to the phone home screen.

## Stack

- Static front-end in `public/` (vanilla JS, Chart.js, jsPDF + AutoTable from cdnjs)
- Cloudflare Worker in `src/worker.ts` serving the assets, `POST /api/read`
  (vision), and the readings sync API (`GET /api/readings`,
  `POST /api/readings/sync`) in `src/readings.ts`
- Cloudflare D1 database `bp4me` (binding `DB`, schema in `migrations/`); the
  user id comes from the portal session cookie forwarded by the gate
  (`src/session.ts`)
- Gemini API (`generateContent` over plain `fetch`, no SDK) with a JSON
  `responseSchema`; model `gemini-flash-latest` by default, overridable with the
  `BP4ME_MODEL` var in `wrangler.jsonc`

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # put your GEMINI_API_KEY in it; BP4ME_DEV_USER=owner is preset
npx wrangler d1 migrations apply bp4me --local   # create the local D1 schema (once)
npm run dev                      # http://localhost:8787
```

Without an API key the app still runs; the photo button reports that the vision
service is not configured and you enter values by hand. `wrangler dev` has no
portal cookie, so the readings API acts as the `BP4ME_DEV_USER` from `.dev.vars`.

## Deploy

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler d1 migrations apply bp4me --remote   # only when ./migrations has a new file
npm run deploy
```

Optionally `npx wrangler secret put SESSION_SECRET` with the portal's value: the
Worker then re-verifies the session cookie's signature instead of relying on the
gate alone.

`wrangler.jsonc` deliberately declares no hostname: bp4me.louismonier.com is
owned by the `louismonier-gate` Worker (see `~/Documents/Website`), which checks
the portal login and forwards here through a service binding.

## API

`POST /api/read` with JSON `{ "image": "<base64>", "media_type": "image/jpeg" }`
returns

```json
{
  "ok": true,
  "reading": { "found": true, "sys": 128, "dia": 82, "pul": 66,
               "confidence": "high", "irregular_heartbeat": false, "notes": "..." },
  "warning": null,
  "model": "gemini-3.8-flash",
  "usage": { "input_tokens": 1100, "output_tokens": 60 }
}
```

`GET /api/readings?since=<ms>` returns the signed-in user's readings and
deletions written after `since` (D1 clock) with the next `cursor`; the client
keeps the cursor and only pulls what changed. `POST /api/readings/sync` with
`{ "upserts": [reading...], "deletes": [{ "id", "updatedAt" }...] }` applies
queued changes; per reading, the newer `updatedAt` wins and a tie goes to the
deletion. Both require the portal session (401 otherwise).

`GET /api/health` reports whether the vision key and the database are configured
and whether the request carries a valid session.

## Disclaimer

BP4me is a logging aid, not a medical device. Always confirm the numbers against
your monitor and discuss your readings with a clinician.
