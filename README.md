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
- **Privacy** — readings are stored only in the browser (localStorage). Export and
  import JSON, or export CSV, from Settings. Photos are sent to the vision API
  for reading and are not stored anywhere.
- **Installable** — a web-app manifest lets you add BP4me to the phone home screen.

## Stack

- Static front-end in `public/` (vanilla JS, Chart.js, jsPDF + AutoTable from cdnjs)
- Cloudflare Worker in `src/worker.ts` serving the assets and `POST /api/read`
- Gemini API (`generateContent` over plain `fetch`, no SDK) with a JSON
  `responseSchema`; model `gemini-flash-latest` by default, overridable with the
  `BP4ME_MODEL` var in `wrangler.jsonc`

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # put your GEMINI_API_KEY in it
npm run dev                      # http://localhost:8787
```

Without an API key the app still runs; the photo button reports that the vision
service is not configured and you enter values by hand.

## Deploy

```bash
npx wrangler secret put GEMINI_API_KEY
npm run deploy
```

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

`GET /api/health` reports whether the vision key is configured.

## Disclaimer

BP4me is a logging aid, not a medical device. Always confirm the numbers against
your monitor and discuss your readings with a clinician.
