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
  type TEXT NOT NULL CHECK (type IN ('CASH_DEPOSIT', 'CASH_EXPENSE', 'CARD_EXPENSE')),
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

-- Indexes for the per-trip lookups the app makes
CREATE INDEX IF NOT EXISTS mini_groups_trip_idx ON mini_groups(trip_id);
CREATE INDEX IF NOT EXISTS participants_trip_idx ON participants(trip_id);
CREATE INDEX IF NOT EXISTS transactions_trip_idx ON transactions(trip_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS splits_tx_idx ON transaction_splits(transaction_id);
CREATE INDEX IF NOT EXISTS budget_items_trip_idx ON budget_items(trip_id);
CREATE INDEX IF NOT EXISTS media_trip_idx ON media(trip_id, kind, created_at DESC);

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
