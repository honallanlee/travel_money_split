# Travel Hub

One place for a group trip: the day-by-day itinerary and hotels, a shared cash kitty run by a
Treasurer, split expenses and receipt scanning, family balances with a simple settle-up plan,
budgets, analytics and photos — on everyone's phone, in English or 繁體中文.

Mobile-first Next.js app for splitting group travel costs, running a shared physical cash
kitty held by a Treasurer, settling up by family, scanning receipts with Gemini, and
tracking budget vs. actual spend.

## Quick start

```bash
npm install
cp .env.example .env.local   # set at least ADMIN_PASSWORD
npm run dev
```

Open http://localhost:3000 and tap **Load Demo Trip Data**.

Without Supabase variables the app uses an **in-memory store** (data resets on restart)
so you can try it immediately. Add the Supabase keys to persist data.

## Currencies

- Trips default to **JPY**. All recording and settlement happens in the trip's base
  currency, rounded to its smallest unit (whole yen for JPY).
- Expenses can be entered in any currency with an exchange rate to the base currency.
- **Display currency:** any viewer can tap the currency chip in the header to see the whole
  trip converted to their own currency (GBP, HKD, USD…). Rates come from `/api/rates`
  (ECB via frankfurter.dev, falling back to open.er-api.com, cached 6 h), or a rate the
  viewer types in. The choice is stored per browser and never changes the recorded data.
  The WhatsApp summary uses the viewer's display currency and notes the rate.
- New expenses default to **Kitty cash** (paid from the Treasurer's cash pool).

## Trip guide (Guide tab)

A read-only itinerary for a trip — day-by-day plan, hotels, flights and before-you-go notes —
shown in the **Guide** tab next to Planner. It is not edited in the app: the Treasurer loads a
JSON file (format: `TripGuide` in `lib/types.ts`) with

```bash
curl -X PUT -H 'content-type: application/json' -b <treasurer cookie> \
  --data-binary @guides/my-trip.json https://<site>/api/trips/<trip-id>/guide
```

Guides live in the database (`trip_guides`), **not in git** — `guides/` is git-ignored because
itineraries contain names, flights and bookings. Lines under `private` (booking/confirmation
numbers, login IDs) are only sent to viewers in Treasurer Mode.

## Photos, avatars, backups & language

- **Photos tab:** anyone with the trip link can add trip photos and set a traveller's avatar
  (images are resized on the phone, checked server-side to be real JPEG/PNG/WebP, max
  1.5 MB, 500 photos per trip). Only the Treasurer can delete photos. Images live in the
  `media` table and are served from `/api/media/[id]` — no Storage bucket needed.
- **Backup & export (Menu):** anyone can download a full `.json` backup or a `.csv`
  spreadsheet to their phone. In Treasurer Mode, **Restore from backup file** (Menu or home
  page) re-creates the trip as a *new* copy — nothing is overwritten. Photos aren't included
  in backups.
- **Offline copy:** each device keeps the last loaded copy of a trip. If the server or
  database can't be reached, the app shows that copy read-only with a banner, and backups
  can still be downloaded from it.
- **Language:** English / 繁體中文 switch on the home page and in the Menu; remembered per
  device (defaults to Chinese for zh-TW/HK/MO browsers). Translations live in
  `lib/i18n-zh.ts`, keyed by the English text.

## Supabase setup

1. Create a project, open the SQL editor and run [`supabase/schema.sql`](supabase/schema.sql).
   It's safe to re-run after upgrades (it adds the `media` table and avatar column).
2. Copy the project URL, anon key and **service role key** into `.env.local`.

All database access happens server-side with the service-role key. The schema enables
Row Level Security with no policies, so the public anon key can't read or write tables
directly — public read-only viewers go through `GET /api/trips/[id]`.

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (not used for data access; kept for parity) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key used by API routes |
| `ADMIN_PASSWORD` | Treasurer Mode password |
| `GEMINI_API_KEY` | Google AI Studio key for receipt OCR |
| `GEMINI_MODEL` | Optional; by default the app tries `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-3.8-flash` |
| `SESSION_SECRET` | Optional; HMAC key for sessions (defaults to `ADMIN_PASSWORD`) |

Set the same variables in Vercel → Project Settings → Environment Variables.

## Security model

- Anyone with a trip URL gets a read-only view.
- `POST /api/auth` checks the password (constant-time) and sets an HMAC-signed
  `treasurer_session` cookie: `HttpOnly`, `SameSite=Strict`, and `Secure` in production.
  Changing `ADMIN_PASSWORD` invalidates all sessions.
- Every `POST`/`PUT`/`DELETE` route (and `/api/ocr`) verifies the cookie server-side.
- `/api/demo` can be called without a session only while the database is empty.

## Accounting rules

| Type | Cash pool | Payer | Split participants |
|---|---|---|---|
| `CASH_DEPOSIT` | `+amount` | `+amount` (depositor) | — |
| `CASH_EXPENSE` | `−amount` | — | `−share` |
| `CARD_EXPENSE` | — | `+amount` | `−share` |

`net = deposits + card paid − shares`; members of a mini-group are summed and settle as one
unit. Since Σ net equals the cash left in the kitty, leftover cash appears as a
**Cash Kitty** party in the settlement plan (the Treasurer hands it back). Settlement uses
greedy largest-debtor ↔ largest-creditor matching. Maths is done in integer cents —
see [`lib/settlement.ts`](lib/settlement.ts) and its tests.

## Scripts

- `npm run dev` — dev server
- `npm test` — unit tests for the ledger maths (Vitest)
- `npm run build` — production build + type check

## API

| Route | Methods |
|---|---|
| `/api/auth` | `GET` status, `POST` unlock, `DELETE` lock |
| `/api/trips`, `/api/trips/[id]` | `GET` (public), `POST`/`PUT`/`DELETE` |
| `/api/participants`, `/api/mini-groups`, `/api/transactions`, `/api/budgets` | `POST`, `[id]` `PUT`/`DELETE` |
| `/api/ocr` | `POST` multipart `file` or JSON `{ image: base64 }` |
| `/api/demo` | `POST` seed sample trip |
| `/api/rates?base=JPY` | `GET` live reference rates (public) |
| `/api/trips/[id]/export` | `GET` JSON backup (public) |
| `/api/import` | `POST` restore a backup as a new trip (Treasurer) |
| `/api/media` | `POST` multipart upload of a photo or avatar (public, image-only) |
| `/api/media/[id]` | `GET` image (public), `PUT` caption / `DELETE` (Treasurer) |
