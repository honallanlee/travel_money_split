-- Group Travel Expense & Cash Pool Splitter — Supabase schema
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to re-run: it only adds what is missing.

CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'JPY',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mini_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  mini_group_id UUID REFERENCES mini_groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  is_treasurer BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('CASH_DEPOSIT', 'CASH_EXPENSE', 'CARD_EXPENSE', 'CASH_PAYOUT', 'TRANSFER', 'REFUND')),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Food & Drink',
  amount_local NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL,
  exchange_rate_to_base NUMERIC(12, 6) NOT NULL DEFAULT 1.0,
  amount_base NUMERIC(12, 2) NOT NULL,
  paid_by_participant_id UUID REFERENCES participants(id) ON DELETE SET NULL,
  receipt_url TEXT,
  line_items JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transaction_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
  share_amount_base NUMERIC(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS budget_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  planned_amount_base NUMERIC(12, 2) NOT NULL,
  notes TEXT
);

-- Photos & avatars. Images are stored compressed (base64 JPEG, ~100–400 KB) and served
-- through /api/media/[id], so no Storage bucket setup is needed.
CREATE TABLE IF NOT EXISTS media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('avatar', 'photo')),
  participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  caption TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE participants ADD COLUMN IF NOT EXISTS avatar_media_id UUID REFERENCES media(id) ON DELETE SET NULL;

-- Receipts (linked to expenses through transactions.receipt_url) are stored like trip photos.
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_kind_check;
ALTER TABLE media ADD CONSTRAINT media_kind_check CHECK (kind IN ('avatar', 'photo', 'receipt'));

-- Trip photos live in Supabase Storage (private bucket "trip-photos", 1 GB on Free); the media row
-- keeps only the file paths. Avatars stay in the database (data column).
ALTER TABLE media ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS thumb_path TEXT;
ALTER TABLE media ALTER COLUMN data DROP NOT NULL;
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_has_content;
ALTER TABLE media ADD CONSTRAINT media_has_content CHECK (data IS NOT NULL OR storage_path IS NOT NULL);

-- Private bucket: no public URLs, no policies (only the server's service-role key can read or write),
-- 1.5 MB per file, images only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('trip-photos', 'trip-photos', false, 1500000, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 1500000, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Database size for the storage bar and the "database nearly full" guard (server only).
CREATE OR REPLACE FUNCTION public.db_size_bytes() RETURNS bigint
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT pg_database_size(current_database()) $$;
REVOKE ALL ON FUNCTION public.db_size_bytes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.db_size_bytes() TO service_role;

-- Upgrade: allow every transaction type on databases created earlier
-- (CASH_PAYOUT = kitty pays someone, TRANSFER = direct settle-up, REFUND = money back from a shop).
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('CASH_DEPOSIT', 'CASH_EXPENSE', 'CARD_EXPENSE', 'CASH_PAYOUT', 'TRANSFER', 'REFUND'));

-- Read-only trip guide (itinerary, hotels, notes) shown in the Guide tab. One row per trip.
-- Booking references inside it are stripped by the API unless the viewer is in Treasurer Mode.
CREATE TABLE IF NOT EXISTS trip_guides (
  trip_id UUID PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Previous versions of each trip guide, kept on every save so an overwrite can be undone.
CREATE TABLE IF NOT EXISTS trip_guide_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  saved_at TIMESTAMPTZ DEFAULT now()
);

-- Costs settled outside the app (hotels, flights booked before the trip) or still to pay on the spot.
-- They count towards each person's trip total but never towards the kitty or the settle-up plan.
-- shares = [{ "participant_id": "...", "amount": 123.45 }] in the item's own currency.
CREATE TABLE IF NOT EXISTS prepaid_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Accommodation',
  currency TEXT NOT NULL DEFAULT 'JPY',
  exchange_rate_to_base NUMERIC(12, 6) NOT NULL DEFAULT 1.0,
  status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'due', 'recorded')),
  date DATE,
  note TEXT,
  shares JSONB NOT NULL DEFAULT '[]'::jsonb,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Treasurer login lockout (shared across server instances). id = 'global' or 'ip:<salted hash>'.
CREATE TABLE IF NOT EXISTS auth_attempts (
  id TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ
);

-- Indexes for the per-trip lookups the app makes
CREATE INDEX IF NOT EXISTS mini_groups_trip_idx ON mini_groups(trip_id);
CREATE INDEX IF NOT EXISTS participants_trip_idx ON participants(trip_id);
CREATE INDEX IF NOT EXISTS transactions_trip_idx ON transactions(trip_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS splits_tx_idx ON transaction_splits(transaction_id);
CREATE INDEX IF NOT EXISTS budget_items_trip_idx ON budget_items(trip_id);
CREATE INDEX IF NOT EXISTS media_trip_idx ON media(trip_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS prepaid_items_trip_idx ON prepaid_items(trip_id);
CREATE INDEX IF NOT EXISTS transactions_receipt_idx ON transactions(receipt_url) WHERE receipt_url IS NOT NULL;
CREATE INDEX IF NOT EXISTS trip_guide_versions_trip_idx ON trip_guide_versions(trip_id, saved_at DESC);

-- Row Level Security: all reads and writes go through the Next.js API using the
-- service-role key (which bypasses RLS). Enabling RLS with no policies means the
-- public anon key cannot read or write these tables directly.
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE mini_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE media ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_guides ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_guide_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prepaid_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_attempts ENABLE ROW LEVEL SECURITY;

-- Second layer: the app never uses the public (anon) or signed-in (authenticated) API roles, so they
-- get no access to app tables or functions at all, now or for tables created later.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
