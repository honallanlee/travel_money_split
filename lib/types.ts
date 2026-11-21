export type TxType = "CASH_DEPOSIT" | "CASH_EXPENSE" | "CARD_EXPENSE";

export const TX_TYPES: TxType[] = ["CASH_DEPOSIT", "CASH_EXPENSE", "CARD_EXPENSE"];

export const CATEGORIES = [
  "Food & Drink",
  "Transport",
  "Accommodation",
  "Flights",
  "Activities",
  "Shopping",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CURRENCIES = [
  "JPY", "GBP", "USD", "EUR", "HKD", "AUD", "CAD", "CHF", "CNY", "TWD", "KRW", "SGD", "MYR", "THB", "PHP", "IDR", "INR", "NZD", "SEK", "NOK", "DKK",
];

export interface Trip {
  id: string;
  name: string;
  base_currency: string;
  created_at?: string;
}

export interface MiniGroup {
  id: string;
  trip_id: string;
  name: string;
}

export interface Participant {
  id: string;
  trip_id: string;
  mini_group_id: string | null;
  name: string;
  is_treasurer: boolean;
  avatar_media_id?: string | null;
}

export interface MediaItem {
  id: string;
  trip_id: string;
  kind: "avatar" | "photo";
  participant_id: string | null;
  width: number | null;
  height: number | null;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface Split {
  id?: string;
  transaction_id?: string;
  participant_id: string;
  share_amount_base: number;
}

export interface LineItem {
  description: string;
  amount: number;
  /** participant ids this item is assigned to (itemised receipt splitting) */
  assignees?: string[];
}

export interface Transaction {
  id: string;
  trip_id: string;
  type: TxType;
  title: string;
  category: string;
  amount_local: number;
  currency: string;
  exchange_rate_to_base: number;
  amount_base: number;
  paid_by_participant_id: string | null;
  receipt_url: string | null;
  line_items: LineItem[] | null;
  occurred_at: string;
  created_at?: string;
  splits: Split[];
}

export interface BudgetItem {
  id: string;
  trip_id: string;
  category: string;
  planned_amount_base: number;
  notes: string | null;
}

export interface TripBundle {
  trip: Trip;
  mini_groups: MiniGroup[];
  participants: Participant[];
  transactions: Transaction[];
  budget_items: BudgetItem[];
  photos: MediaItem[];
}

/** Portable backup file (see /api/trips/[id]/export and /api/import). */
export interface TripBackup {
  format: "trip-kitty-backup";
  version: 1;
  exported_at: string;
  trip: Pick<Trip, "name" | "base_currency">;
  mini_groups: { id: string; name: string }[];
  participants: { id: string; name: string; mini_group_id: string | null; is_treasurer: boolean }[];
  transactions: Omit<Transaction, "trip_id" | "created_at">[];
  budget_items: Omit<BudgetItem, "id" | "trip_id">[];
}

export interface OcrResult {
  merchant: string;
  date: string;
  currency: string;
  total: number;
  category: Category;
  line_items: { description: string; amount: number }[];
}
