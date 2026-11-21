# Trip Kitty — Build Document

Group travel expense & cash-pool splitter. Mobile-first web app for a group trip (default
currency **Japanese yen**): log shared spending, run a physical cash kitty held by a
Treasurer, settle up by family, scan receipts with AI, track budget vs. actual, share
photos, and switch between **English and Traditional Chinese (繁體中文)**.

_Generated 21 Nov 2026 from the code in this repository._

---

## 1. Contents

1. [Contents](#1-contents)
2. [API keys & environment variables](#2-api-keys--environment-variables)
3. [Running locally](#3-running-locally)
4. [Deploying to Vercel + Supabase](#4-deploying-to-vercel--supabase)
5. [Features](#5-features)
6. [Accounting rules](#6-accounting-rules)
7. [Security model](#7-security-model)
8. [Architecture & file map](#8-architecture--file-map)
9. [Database schema](#9-database-schema)
10. [API reference](#10-api-reference)
11. [Currencies](#11-currencies)
12. [Backup, restore & offline copy](#12-backup-restore--offline-copy)
13. [Photos & avatars](#13-photos--avatars)
14. [Language (i18n)](#14-language-i18n)
15. [Testing](#15-testing)
16. [Design decisions & known limitations](#16-design-decisions--known-limitations)
17. [Build history](#17-build-history)

---

## 2. API keys & environment variables

| Variable | Required? | What it's for | Where to get it | Cost |
|---|---|---|---|---|
| `ADMIN_PASSWORD` | **Yes** | Treasurer Mode password | You make it up — use something long | Free |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** for saved data | Database address | Supabase dashboard → **Project Settings → API** (or **Data API**) → *Project URL* | Free tier available |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** for saved data | Server-side database access | Supabase dashboard → **Project Settings → API Keys** → `service_role` key (legacy tab) or a **secret** key (`sb_secret_…`) | Free tier available |
| `GEMINI_API_KEY` | Optional | Receipt scanning (OCR) | [Google AI Studio](https://aistudio.google.com/apikey) → *Create API key* | Free tier available (rate-limited) |
| `GEMINI_MODEL` | Optional | Override the OCR model. Default: tries `gemini-3.5-flash-lite`, then `gemini-3.1-flash-lite`, then `gemini-3.8-flash` (see §16) | — | — |
| `SESSION_SECRET` | Optional | Separate signing secret for Treasurer sessions (defaults to `ADMIN_PASSWORD`) | Any long random string | Free |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Not used | Listed in the original spec; the app never reads it | — | — |

**No key needed:** live exchange rates (ECB via frankfurter.dev, fallback open.er-api.com).

### Free tiers (check the pricing pages — limits change)

- **Supabase Free** — a small Postgres database (on the order of 500 MB), enough for many
  trips including photos. Free projects **pause after about a week with no activity**; you
  un-pause them from the dashboard. <https://supabase.com/pricing>
- **Google Gemini API free tier** — free with per-minute/per-day request limits, plenty for
  scanning receipts on a trip. On the free tier Google may use prompts/images to improve
  its products; enable billing for the paid tier if that matters to you.
  <https://ai.google.dev/pricing>
- **Vercel Hobby** — free for personal, non-commercial projects.
  <https://vercel.com/pricing>

### Where to put them

**Locally:** in `.env.local` in the project root (already created, holding a generated
test `ADMIN_PASSWORD`; it is git-ignored). Restart `npm run dev` after editing.

```env
ADMIN_PASSWORD=your-long-treasurer-password
NEXT_PUBLIC_SUPABASE_URL=https://abcd1234.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...or...sb_secret_...
GEMINI_API_KEY=AIza...
```

**On Vercel:** Project → **Settings → Environment Variables** → add each name/value for
*Production* (and *Preview* if you use it) → **Redeploy**.

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` bypasses database security. Never put it in client code,
> chat messages or a public repo. It is only read on the server.

---

## 2b. Leaving the app idle (e.g. weeks before the trip)

- **Supabase Free pauses a project after about a week with no activity.** A paused project
  makes the app show errors until you press **Restore** in the Supabase dashboard (data is
  kept; restoring takes a few minutes).
- **Prevention (built in):** `vercel.json` schedules a Vercel Cron job that calls
  `/api/keepalive` once a day; it runs one tiny database read so Supabase sees activity.
  It only runs on the deployed site (not locally). Optionally set `CRON_SECRET` in Vercel so
  only Vercel's cron can call it. Check it under Vercel → Project → **Cron Jobs**.
- **Still worth doing:** open the app and check it a day or two before you fly.
- **Treasurer sessions last 7 days** — expect to unlock Treasurer Mode again after a break.
- Gemini keys and Vercel Hobby deployments don't expire from inactivity.

## 3. Running locally

Requires Node.js 20+ (Node 22 LTS was installed for this build at `~/.local/node`).

```bash
export PATH="$HOME/.local/node/bin:$PATH"   # only if you use the bundled Node
npm install
npm run dev          # http://localhost:3000
npm test             # unit tests
npm run build        # production build + type check
```

Without Supabase keys the app uses an **in-memory store** (yellow banner; data resets on
restart). Tap **Load Demo Trip Data** on the home page to get a sample Japan trip.

---

## 4. Deploying to Vercel + Supabase

1. **Supabase:** create a project → **SQL Editor** → paste and run
   [`supabase/schema.sql`](../supabase/schema.sql). It is safe to re-run after upgrades.
2. Copy the Project URL and service-role/secret key (see §2).
3. **Gemini (optional):** create a key in Google AI Studio.
4. **Vercel:** push this repo to GitHub → *Add New Project* → import it (Next.js is
   auto-detected) → add the environment variables → Deploy.
5. Open the site, unlock Treasurer Mode with your `ADMIN_PASSWORD`, create the trip (or
   load the demo), and share the trip URL with the group.

---

## 5. Features

### Roles
- **Read-only (default):** anyone with a trip URL sees the feed, cash kitty, balances,
  settlement plan, analytics, planner and photos. They can also upload photos/avatars,
  change their display currency and language, and download backups.
- **Treasurer Mode:** lock icon → password → add/edit/delete transactions, people,
  families, budgets; delete photos; restore backups.

### Tabs (bottom navigation)
| Tab | What it shows |
|---|---|
| **Feed** | Cash wallet card (expected cash in the Treasurer's wallet, deposits, cash spent, *Reconcile cash* check) and a day-grouped transaction list with `CASH DEPOSIT` / `CASH` / `CARD` pills, payer avatar badge, split count. Tap to expand splits and receipt items; Treasurer gets *Edit*. |
| **Settle** | Family / solo cards with net balance (expand for each member's cash in, card paid, share, net), the cash-kitty leftover, the simplified settlement plan, **Copy Summary for WhatsApp** and a WhatsApp share link. |
| **Photos** | Traveller avatars (tap a face to upload) and a trip photo gallery with captions. |
| **Analytics** | Total cost, average per day, average per person, cash-vs-card split; spend by category (bars or table); cumulative / daily spend trend. |
| **Planner** | Budget per category vs. actual, progress bars with *NEAR LIMIT* / *OVER* flags, unbudgeted spending; Treasurer edits planned amounts and notes. |

### Adding money (Treasurer, floating **+ Add** button)
- **Log Expense** — opens on **Kitty cash** by default (paid from the Treasurer's cash
  pool). Switch to **Card** (someone paid by card and gets credited) or **Deposit**.
- **Scan Receipt** — take/choose a photo → Gemini extracts merchant, date, currency, total,
  category and line items → fields are pre-filled.
- **Pay out from kitty** — kitty cash handed to someone: paying back a person who covered a
  shared cost with their own card/cash, or settling up. Shows how much they are owed with a
  one-tap *Use* button, and warns if the kitty holds less. Payouts are not spending, so they
  don't appear in analytics or budgets.
- **Record settle-up payment** — one person pays another directly (cash, bank transfer,
  PayPay…); the kitty isn't involved. Every line of the settlement plan has a **Record**
  button that pre-fills the right form.
- **Log refund** — money back from a shop, either as cash into the kitty or onto someone's
  card; the shares are given back and analytics count it as negative spending.
- **Split payment** — tick *Paid partly with kitty cash, partly by card* on a new expense;
  it is saved as a kitty part and a card part with each person's share divided between them.
- **Delete** — every transaction in the feed has Edit and Delete buttons in Treasurer Mode.
- **Log Cash Deposit** — defaults to **Everyone, same amount**: enter the amount each person puts in, untick anyone who isn't contributing, and one deposit per person is saved in a single step. Switch to **One person** for an individual top-up.
- Split modes: **Equally** (tick people), **Custom** (amount per person, must add up),
  **Line items** (assign each receipt item to people; tax/tip/service spread
  proportionally).
- Any currency, with an editable exchange rate to the trip currency.

### Menu (☰)
Language switch, display currency, **Download backup (.json)**, **Download spreadsheet
(.csv)**, and for the Treasurer: **Restore from backup file** and **Trip & travellers**
(rename trip, base currency, families, travellers, treasurer star, delete trip).

---

## 6. Accounting rules

All maths is in [`lib/settlement.ts`](../lib/settlement.ts), computed in integer minor
units to avoid floating-point drift.

| Type | Cash pool | Payer | Split participants |
|---|---|---|---|
| `CASH_DEPOSIT` | `+amount` | `+amount` (depositor) | — |
| `CASH_EXPENSE` | `−amount` | — | `−share` each |
| `CARD_EXPENSE` | — | `+amount` | `−share` each |
| `CASH_PAYOUT` | `−amount` | `−amount` (recipient: received cash) | — |
| `TRANSFER` (settle-up) | — | `+amount` (payer) | receiver `−amount` |
| `REFUND` | `+amount` if cash back to kitty | card refund: that person `−amount` | `+share` each (given back) |

- `Expected cash in Treasurer's wallet = Σ deposits − Σ cash expenses − Σ kitty payouts`
- `net = deposits + card paid − shares − cash received from the kitty` (positive = is owed, negative = owes)
- Members of a family (mini-group) are summed and settle as one unit.
- Because Σ(net) equals the cash still in the kitty, leftover cash appears as a
  **Cash Kitty (Treasurer)** party in the settlement plan, so the Treasurer hands it back.
- **Settlement:** greedy — repeatedly pair the largest debtor with the largest creditor and
  settle the smaller amount, until everything is under one minor unit.
- **Rounding:** amounts round to the trip currency's smallest unit (**whole yen** for JPY,
  pence/cents otherwise). Splits use largest-remainder allocation so shares always add up
  exactly (¥1,000 ÷ 3 → ¥334 / ¥333 / ¥333).
- **Line items:** each item is divided among its assignees; per-person subtotals are then
  scaled to the receipt total, so tax/tip/service (or discounts) are shared proportionally.

---

## 7. Security model

- `POST /api/auth` compares the password to `ADMIN_PASSWORD` in constant time (failed
  attempts are delayed). On success it sets `treasurer_session`: an HMAC-signed token with a
  7-day expiry, `HttpOnly`, `SameSite=Strict`, `Secure` in production (not on
  `http://localhost`, where Safari would drop it). Changing the password invalidates all
  sessions.
- Every create/update/delete route checks the cookie on the server
  (`treasurerRoute` in [`lib/http.ts`](../lib/http.ts)). Verified: all return **401**
  without it, including with a forged cookie.
- Exceptions by design: `/api/demo` works without login **only while the database is
  empty**; `/api/media` (upload) is open to anyone with the trip link.
- All database access is server-side with the service-role key. The schema enables Row
  Level Security with no policies, so the public anon key can't read or write tables.
- Server-side validation on every write: types, amounts, currency codes, participants
  belonging to the trip, splits adding up to the total (±1 minor unit per person,
  normalised exactly).
- Uploads: the real file type is detected from its bytes (JPEG/PNG/WebP only), 1.5 MB max,
  500 photos per trip; images are served with `nosniff` and a locked-down CSP.

---

## 8. Architecture & file map

**Stack:** Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Recharts ·
lucide-react · Supabase (Postgres) · Google Gemini (`@google/genai`) · Vitest.

Pages fetch a whole trip from `GET /api/trips/[id]` and compute the ledger in the browser
with the same pure functions the tests cover.

```
app/
  layout.tsx                 Root layout + LanguageProvider
  page.tsx                   Home: trip list, demo loader, create trip, restore backup
  trips/[id]/page.tsx        Trip page → <TripApp>
  api/…                      Route handlers (see §10)
components/
  TripApp.tsx                Trip shell: header, tabs, + Add menu, offline copy, modals
  FeedTab.tsx                Cash wallet card, reconcile, transaction feed
  BalancesTab.tsx            Family balances, settlement plan, WhatsApp export
  PhotosTab.tsx              Avatars + photo gallery
  AnalyticsTab.tsx           Metrics and charts
  PlannerTab.tsx             Budget vs actual
  TransactionModal.tsx       Add/edit transaction, receipt scan, 3 split modes
  PeopleModal.tsx            Trip settings, families, travellers
  TripMenu.tsx               Language, currency, backups
  DisplayCurrency.tsx        Per-viewer display currency + picker
  ImportBackup.tsx           Restore-from-file button
  UnlockModal.tsx            Treasurer password dialog
  ui.tsx                     Shared UI: Modal, Button, Money, Avatar, pills…
  useTreasurer.ts            Session state hook
lib/
  settlement.ts              Ledger maths, rounding, splits, settlement, WhatsApp text
  analytics.ts               Category totals, daily series, metrics, budget comparison
  repo.ts                    Data access + validation, demo seed, media, import/export
  db/store.ts                Supabase store + in-memory fallback (same interface)
  auth.ts                    Password check, signed session cookie
  http.ts                    Route wrappers (error handling, Treasurer check)
  validation.ts              Input validators
  backup.ts                  Trip → portable JSON backup
  exportCsv.ts               Transactions → CSV
  i18n.tsx, i18n-zh.ts       Language provider + Traditional Chinese strings
  client.ts                  Browser fetch helper, image resize, file download
  types.ts                   Shared types, categories, currencies
supabase/schema.sql          Database schema (re-runnable)
tests/                       Vitest unit tests
```

---

## 9. Database schema

Full SQL: [`supabase/schema.sql`](../supabase/schema.sql).

| Table | Key columns |
|---|---|
| `trips` | `id`, `name`, `base_currency` (default `JPY`), `created_at` |
| `mini_groups` | `id`, `trip_id` → trips (cascade), `name` |
| `participants` | `id`, `trip_id`, `mini_group_id` → mini_groups (set null), `name`, `is_treasurer`, `avatar_media_id` → media (set null) |
| `transactions` | `id`, `trip_id`, `type` (`CASH_DEPOSIT`/`CASH_EXPENSE`/`CARD_EXPENSE`/`CASH_PAYOUT`/`TRANSFER`/`REFUND`), `title`, `category`, `amount_local`, `currency`, `exchange_rate_to_base`, `amount_base`, `paid_by_participant_id`, `receipt_url`, `line_items` (JSONB, with `assignees`), `occurred_at` |
| `transaction_splits` | `id`, `transaction_id` (cascade), `participant_id` (cascade), `share_amount_base` |
| `budget_items` | `id`, `trip_id`, `category`, `planned_amount_base`, `notes` |
| `media` | `id`, `trip_id` (cascade), `kind` (`avatar`/`photo`), `participant_id` (cascade), `mime`, `data` (base64), `byte_size`, `width`, `height`, `caption`, `uploaded_by`, `created_at` |

Categories: Food & Drink, Transport, Accommodation, Flights, Activities, Shopping, Other.

---

## 10. API reference

🔓 public · 🔒 Treasurer cookie required

| Route | Method | Access | Purpose |
|---|---|---|---|
| `/api/auth` | GET | 🔓 | `{ unlocked }` |
| `/api/auth` | POST | 🔓 | `{ password }` → sets session cookie |
| `/api/auth` | DELETE | 🔓 | Lock (clear cookie) |
| `/api/trips` | GET | 🔓 | List trips + storage mode |
| `/api/trips` | POST | 🔒 | Create trip `{ name, base_currency }` |
| `/api/trips/[id]` | GET | 🔓 | Full trip bundle (people, groups, transactions + splits, budgets, photo metadata) |
| `/api/trips/[id]` | PUT / DELETE | 🔒 | Rename / change currency / delete |
| `/api/trips/[id]/export` | GET | 🔓 | JSON backup |
| `/api/import` | POST | 🔒 | Restore a backup as a new trip |
| `/api/mini-groups` (+`/[id]`) | POST / PUT / DELETE | 🔒 | Families |
| `/api/participants` (+`/[id]`) | POST / PUT / DELETE | 🔒 | Travellers (`is_treasurer` is exclusive) |
| `/api/transactions` (+`/[id]`) | POST / PUT / DELETE | 🔒 | Transactions with `splits[]` |
| `/api/budgets` (+`/[id]`) | POST / PUT / DELETE | 🔒 | Budget lines |
| `/api/transactions/deposits` | POST | 🔒 | Same-amount deposit for several people `{ trip_id, amount_local, currency, exchange_rate_to_base?, participant_ids[], title?, occurred_at? }` (one transaction each, single insert) |
| `/api/ocr` | POST | 🔒 | Receipt image (multipart `file` or `{ image: base64 }`) → `{ merchant, date, currency, total, category, line_items[] }` |
| `/api/media` | POST | 🔓 | Upload photo/avatar (multipart: `file`, `trip_id`, `kind`, `participant_id?`, `caption?`, `uploaded_by?`) |
| `/api/media/[id]` | GET | 🔓 | Image bytes (cached immutable) |
| `/api/media/[id]` | PUT / DELETE | 🔒 | Edit caption / delete |
| `/api/rates?base=JPY` | GET | 🔓 | Live reference exchange rates (cached 6 h) |
| `/api/transactions/split-payment` | POST | 🔒 | One bill, part kitty cash + part card (two linked expenses) |
| `/api/keepalive` | GET | 🔓 (or `CRON_SECRET`) | Daily ping so Supabase Free doesn't pause |
| `/api/demo` | POST | 🔓 if empty, else 🔒 | Seed the Japan demo trip |

---

## 11. Currencies

- **Trip (base) currency** — default **JPY**. Everything is recorded, split and settled in it.
- **Entry currency** — any transaction can be entered in another currency (e.g. a GBP
  flight) with an exchange rate; the Treasurer can enter the actual cash rate.
- **Display currency (per viewer)** — tap the currency chip in the header (`JPY ⇄`) and
  pick GBP, HKD, USD or ~160 others to see the whole trip converted. Uses live rates or a
  rate you type in; remembered on that device; doesn't change recorded data. A note shows
  the rate in use. The WhatsApp summary uses the viewer's currency and states the rate.
  The cash wallet card stays in yen (physical cash) with the converted amount beneath.

---

## 12. Backup, restore & offline copy

- **Download backup (.json)** — everything needed to rebuild the trip (people, families,
  transactions with splits and line items, budgets). Built in the browser, so it works
  even from the offline copy. Photos are not included.
- **Download spreadsheet (.csv)** — one row per transaction with a share column per person;
  UTF-8 with BOM so Excel shows Chinese correctly.
- **Restore from backup file** (Treasurer; Menu or home page) — creates a *new* trip named
  "… (restored)". Every row is re-validated; if anything fails, the partial trip is removed.
  Verified: a restored trip had identical transactions and splits.
- **Offline copy (fallout mode)** — each device saves the last loaded trip. If the server or
  database can't be reached, that copy is shown read-only with a red banner and a Retry
  button; editing is paused. Requires the trip to have been opened on that device before.

---

## 13. Photos & avatars

- **Avatars:** Photos tab → tap a traveller's face → choose an image (resized to 400 px).
  Shown in the feed, settle cards, people list. Without one, coloured initials are used.
- **Trip photos:** choose *Who's uploading?* and an optional caption → **Add photos**
  (up to 20 at a time, resized to 1600 px JPEG on the phone). Tap a photo to view it full
  size; the Treasurer can delete it.
- Stored in the `media` table and served from `/api/media/[id]` — no Supabase Storage
  bucket to configure.

---

## 14. Language (i18n)

- **English / 繁體中文** — button on the home page and in the Menu; remembered per device;
  browsers set to zh-TW / zh-HK / zh-MO default to Chinese.
- Covers every screen, categories, dates (zh-TW format), toasts, common server errors and
  the WhatsApp summary.
- Implementation: English text is the key; translations are in
  [`lib/i18n-zh.ts`](../lib/i18n-zh.ts). Missing keys fall back to English and log a warning
  in development. To add a phrase, wrap it in `t("…")` and add the key to `i18n-zh.ts`.
- Not translated: user-entered names/titles, and error messages that embed specific values.

---

## 15. Testing

`npm test` — **26 tests, all passing**:

- `tests/settlement.test.ts` (21): cent allocation, equal/itemised splits with tax scaling,
  cash pool, participant balances, Σnet = pool invariant, family roll-up, debt
  simplification, Cash Kitty leftover, WhatsApp text, whole-yen rounding.
- `tests/backup.test.ts` (5): backup shape, filenames with Chinese, CSV escaping + BOM,
  translation interpolation, Chinese WhatsApp summary.

Also verified by hand in a mobile-sized browser: demo load, all tabs, Treasurer unlock
(wrong + right password), itemised euro expense, display-currency conversion, Chinese UI,
Photos tab, Menu, offline mode; and with curl: every write route returns 401 without a
session, validation errors, OCR "not configured" response, export → import round trip,
photo/avatar upload, fake-image rejection, delete permissions.

**Not verified:** Supabase persistence and live Gemini OCR (need your keys), and picking
real photos from a phone's photo picker.

---

## 16. Design decisions & known limitations

- **Kitty cash is the default** expense type.
- **Uploads are open to anyone with the trip link** (as requested); deletes are
  Treasurer-only. Trip URLs are unguessable UUIDs, but anyone you share the link with can
  upload. Change `app/api/media/route.ts` to `treasurerRoute` to lock it down.
- **Backups exclude photos** to keep files small.
- **Transaction edits** replace splits in two steps (not one database transaction); a
  failure between them could leave splits missing until the expense is saved again.
- **Removing a traveller** deletes their split rows, so old expenses may no longer add up
  to their total; the app warns before removing.
- **Changing a trip's base currency** does not convert existing amounts (warned in the UI).
- **Images in Postgres:** simple and setup-free; fine for a trip, but for thousands of
  photos Supabase Storage would be more efficient.
- **In-memory mode** (no Supabase keys) is for trying the app locally; on Vercel it would
  lose data between requests, so always set the Supabase keys in production.
- **Receipt OCR model:** Google retired `gemini-2.5-flash` for new API keys (it returned
  404). In testing on 21 Nov 2026 the full Flash models took 60 s+ or returned "high
  demand", while `gemini-3.5-flash-lite` read a test receipt perfectly in ~1.5 s. The route
  tries Flash-Lite first, falls back on 404/timeout/overload, gives each attempt 20 s and
  stops by ~50 s so it fits Vercel's 60 s function limit. Errors are shown as short
  messages, not raw Google JSON.
- Recharts 2.x is used (v3 exists); upgrading is optional.

---

## 17. Build history

1. **Initial build from the spec** — Next.js app, ledger maths with tests, Supabase schema,
   auth cookie, all CRUD routes, Gemini OCR route, 4-tab mobile UI, Add/Edit modal with
   itemised splitting, Treasurer unlock, WhatsApp export, demo data, in-memory fallback.
2. **Kitty-cash default & yen** — new expenses and scans default to Kitty cash; trips
   default to JPY with whole-yen rounding; per-viewer display currency with live rates or a
   custom rate; Japan demo trip.
3. **Backups, photos & Chinese** — JSON/CSV download, Treasurer restore, offline copy;
   Photos tab with avatars; English / Traditional Chinese switch.
4. **Docs** — this document; `.env.example` clarified (required vs optional keys).
5. **Supabase go-live** — tables created, clearer "tables not found" error.
6. **OCR fix** — retired `gemini-2.5-flash` replaced by Flash-Lite with fallbacks and timeouts.
7. **Group deposits** — "Everyone, same amount" is the default cash-deposit mode.
9. **Settle-ups, refunds, split payments, delete button, keep-alive** — new `TRANSFER` and
   `REFUND` types, `POST /api/transactions/split-payment`, Delete in the feed, daily
   `/api/keepalive` Vercel Cron, and an example trip covering every scenario.
8. **Kitty payouts** — new `CASH_PAYOUT` type for reimbursements and settling up from the
   kitty; **Record** buttons on the kitty lines of the settlement plan. Requires re-running
   `supabase/schema.sql` (updates the `transactions_type_check` constraint).
