// Ordered, append-only migrations for the marketplace.
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const OVERLAP_GUARD = (when: string, extra = "") => `
BEGIN
  SELECT RAISE(ABORT, 'DATES_TAKEN') WHERE EXISTS (
    SELECT 1 FROM calendar_blocks b
     WHERE b.listing_id = NEW.listing_id AND b.status = 'active' ${extra}
       AND b.start_date < NEW.end_date AND b.end_date > NEW.start_date
       AND (NEW.source = 'booking' OR b.source = 'booking')
  );
END;`.replace("BEGIN", `${when}\nBEGIN`);

export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE platform_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  brand_ar TEXT NOT NULL,
  brand_en TEXT NOT NULL,
  support_phone TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
  service_fee_pct REAL NOT NULL DEFAULT 5,
  commission_pct REAL NOT NULL DEFAULT 12,
  managed_pct REAL NOT NULL DEFAULT 25,
  payout_release_hours INTEGER NOT NULL DEFAULT 6,
  deposit_return_days INTEGER NOT NULL DEFAULT 3,
  ical_sync_minutes INTEGER NOT NULL DEFAULT 15,
  ical_stale_minutes INTEGER NOT NULL DEFAULT 60,
  hold_minutes INTEGER NOT NULL DEFAULT 15,
  checkin_hour INTEGER NOT NULL DEFAULT 15,
  checkout_hour INTEGER NOT NULL DEFAULT 12,
  launched INTEGER NOT NULL DEFAULT 0,       -- supply-only mode until launch: public search hidden
  require_guest_id INTEGER NOT NULL DEFAULT 1,
  vat_on_commission_pct REAL NOT NULL DEFAULT 0,      -- confirm with tax advisor (COMPLIANCE.md)
  tourism_license_required INTEGER NOT NULL DEFAULT 0, -- confirm with lawyer (COMPLIANCE.md)
  id_data_retention_days INTEGER NOT NULL DEFAULT 365,
  demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE regions (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE compounds (
  id INTEGER PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  slug TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  km_marker INTEGER,
  lat REAL,
  lng REAL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','inspector','owner')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE owners (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  display_name TEXT NOT NULL,
  phone_enc TEXT,
  identity_status TEXT NOT NULL DEFAULT 'pending' CHECK (identity_status IN ('pending','verified','rejected')),
  identity_ref TEXT,
  payout_method TEXT CHECK (payout_method IN ('bank','instapay','wallet')),
  payout_masked TEXT,
  plan TEXT NOT NULL DEFAULT 'commission' CHECK (plan IN ('commission','managed')),
  agreement_signed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES owners(id),
  compound_id INTEGER NOT NULL REFERENCES compounds(id),
  slug TEXT NOT NULL UNIQUE,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'chalet' CHECK (category IN ('chalet','villa','day_rental','student_room','hourly_space')),
  rental_mode TEXT NOT NULL DEFAULT 'nightly' CHECK (rental_mode IN ('nightly','daily','hourly')),
  capacity INTEGER NOT NULL,
  rooms INTEGER NOT NULL,
  baths INTEGER NOT NULL,
  parking INTEGER NOT NULL DEFAULT 0,
  beachfront INTEGER NOT NULL DEFAULT 0,
  pool INTEGER NOT NULL DEFAULT 0,
  families_only INTEGER NOT NULL DEFAULT 0,
  pets_allowed INTEGER NOT NULL DEFAULT 0,
  location_note_ar TEXT NOT NULL DEFAULT '',
  description_ar TEXT NOT NULL DEFAULT '',
  house_rules_ar TEXT NOT NULL DEFAULT '',
  amenities TEXT NOT NULL DEFAULT '[]',
  address_private TEXT NOT NULL DEFAULT '',          -- revealed only after confirmed payment
  handover_name TEXT NOT NULL DEFAULT '',
  handover_phone_enc TEXT,                           -- revealed only after confirmed payment
  lat REAL,
  lng REAL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','inspected','live','paused')),
  cancellation_policy TEXT NOT NULL DEFAULT 'moderate' CHECK (cancellation_policy IN ('flexible','moderate','strict')),
  security_deposit INTEGER NOT NULL DEFAULT 0,
  ical_export_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE listing_photos (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption_ar TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  photographed_by_us INTEGER NOT NULL DEFAULT 1,
  taken_on TEXT
);

CREATE TABLE inspections (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  inspector_user_id INTEGER NOT NULL REFERENCES users(id),
  checklist TEXT NOT NULL,       -- JSON {item: true|false}
  notes TEXT NOT NULL DEFAULT '',
  passed INTEGER NOT NULL DEFAULT 0,
  inspected_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE price_rules (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('base','weekday_uplift','season')),
  label TEXT NOT NULL DEFAULT '',
  start_date TEXT,
  end_date TEXT,
  weekdays TEXT,
  amount INTEGER,
  percent REAL,
  min_nights INTEGER,
  priority INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE los_discounts (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  min_nights INTEGER NOT NULL,
  percent REAL NOT NULL,
  label TEXT NOT NULL DEFAULT ''
);

CREATE TABLE ical_feeds (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,           -- Airbnb, Booking.com, other
  url TEXT NOT NULL,
  last_sync_at TEXT,
  last_status TEXT,                  -- ok | error
  last_error TEXT,
  events_count INTEGER NOT NULL DEFAULT 0
);

-- One row per blocked range. Bookings, owner blocks and imported events all live here.
CREATE TABLE calendar_blocks (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,            -- exclusive (check-out day)
  source TEXT NOT NULL CHECK (source IN ('booking','owner_block','ical_import')),
  booking_id INTEGER,
  feed_id INTEGER REFERENCES ical_feeds(id) ON DELETE CASCADE,
  external_uid TEXT,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
  conflict INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  CHECK (end_date > start_date)
);
CREATE INDEX blocks_listing ON calendar_blocks (listing_id, status, start_date, end_date);
CREATE UNIQUE INDEX blocks_feed_uid ON calendar_blocks (feed_id, external_uid) WHERE feed_id IS NOT NULL;

-- Database-level guarantee: a booking never overlaps any active block, and an owner block never
-- covers a booking. Imported events may overlap (they are facts from elsewhere) and are flagged.
CREATE TRIGGER blocks_guard_insert BEFORE INSERT ON calendar_blocks ${OVERLAP_GUARD("WHEN NEW.status = 'active' AND NEW.source IN ('booking','owner_block')")}
CREATE TRIGGER blocks_guard_update BEFORE UPDATE OF status, start_date, end_date ON calendar_blocks ${OVERLAP_GUARD("WHEN NEW.status = 'active' AND NEW.source IN ('booking','owner_block')", "AND b.id <> NEW.id")}

CREATE TABLE guests (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone_enc TEXT NOT NULL,
  phone_hash TEXT NOT NULL UNIQUE,
  phone_last4 TEXT NOT NULL,
  email TEXT,
  id_status TEXT NOT NULL DEFAULT 'none' CHECK (id_status IN ('none','verified','failed')),
  id_type TEXT,                      -- national_id | passport
  id_ref TEXT,                       -- verification reference, never the document
  id_last4 TEXT,
  id_verified_at TEXT,
  whatsapp_opt_out INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  public_token TEXT NOT NULL UNIQUE,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  guest_id INTEGER REFERENCES guests(id),
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  guests_count INTEGER NOT NULL,
  nightly_json TEXT NOT NULL,        -- snapshot of each night's price and tier
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  nights_total INTEGER NOT NULL,
  service_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,            -- charged to the guest (nights + fee)
  security_deposit INTEGER NOT NULL,
  policy TEXT NOT NULL,
  plan TEXT NOT NULL,
  commission_pct REAL NOT NULL,
  owner_payout INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('hold','pending_payment','confirmed','checked_in','completed','cancelled','disputed')),
  hold_expires_at TEXT,
  pay_method TEXT CHECK (pay_method IN ('card','wallet','offline')),
  arrival_sent_at TEXT,
  checkin_prompt_sent_at TEXT,
  checkout_reminder_sent_at TEXT,
  review_request_sent_at TEXT,
  checked_in_at TEXT,
  checked_out_at TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancel_reason TEXT,
  refund_amount INTEGER NOT NULL DEFAULT 0,
  seed_key TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  CHECK (check_out > check_in)
);
CREATE INDEX bookings_listing ON bookings (listing_id, check_in);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('charge','deposit')),
  method TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('initiated','paid','authorized','failed','refunded','partially_refunded','voided','captured')),
  provider_ref TEXT,
  provider_order_id TEXT,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  updated_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE deposit_holds (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('authorization','collected')),
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','released','captured')),
  release_due_at TEXT,
  released_at TEXT,
  captured_amount INTEGER NOT NULL DEFAULT 0,
  note TEXT
);

CREATE TABLE payouts (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES owners(id),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','releasable','paid','frozen','cancelled')),
  releasable_at TEXT,
  paid_at TEXT,
  batch_ref TEXT
);

CREATE TABLE refunds (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'done',
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE reviews (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  author_side TEXT NOT NULL CHECK (author_side IN ('guest','owner')),
  author_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text TEXT NOT NULL DEFAULT '',
  reply TEXT,
  reply_at TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  UNIQUE (booking_id, author_side)
);

CREATE TABLE issues (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  raised_by TEXT NOT NULL CHECK (raised_by IN ('guest','owner')),
  type TEXT NOT NULL CHECK (type IN ('not_as_described','access','damage','other')),
  description TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution TEXT,
  resolution_note TEXT,
  amount INTEGER,
  resolved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (${NOW}),
  resolved_at TEXT
);

CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  event_key TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (${NOW}),
  UNIQUE (provider, event_key)
);

CREATE TABLE message_log (
  id INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL DEFAULT 1,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email')),
  template TEXT NOT NULL,
  recipient TEXT NOT NULL,
  lang TEXT NOT NULL,
  body TEXT NOT NULL,
  buttons TEXT,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  amount INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

-- Photos uploaded by inspectors on site (served by /api/photos/:id)
CREATE TABLE photo_blobs (
  id INTEGER PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (${NOW})
);

-- Simulated external calendars (stand-in for an Airbnb/Booking.com iCal URL in the demo).
CREATE TABLE demo_feed_events (
  id INTEGER PRIMARY KEY,
  feed_key TEXT NOT NULL,
  uid TEXT NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT 'Reserved'
);
`,
  },
];
