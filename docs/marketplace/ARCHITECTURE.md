# مصيف (Masyaf) marketplace: architecture

> The brief asks to build on the Manhal codebase and reuse the clinic portal's booking engine. Manhal isn't on
> this machine, so this is a standalone app that **reuses the clinic project's modules unchanged**, and extends
> the booking engine instead of forking it.

## What was reused from the clinic portal

| Module | Status |
|---|---|
| `src/booking-engine/` (time, availability, engine, errors) | Reused as is. **Extended** with `nightly.ts`: nightly price rules, length-of-stay discounts, min-nights, half-open date ranges. Still generic, with no vertical imports, so both products can share it. |
| `src/payments/paymob.ts` | Reused (HMAC verification, Intention API, refunds, sandbox transactions) |
| `src/messaging/index.ts` | Reused (WhatsApp Cloud API + email fallback + MessageLog). Only the log column names changed (booking/guest). |
| `src/lib/` db, crypto, phone, rate-limit | Reused |

## Stack

Next.js 16 (App Router), TypeScript strict, SQLite via Node 24's `node:sqlite`, Vitest. Fonts are El Messiri
and Almarai. Sessions use signed cookies; roles are admin, inspector and owner. Guests don't need an account:
their trip page is reached through an unguessable link.

## Data model

`regions → compounds`, `owners` (identity status, payout method, plan, agreement), `listings` (category with
future niches `day_rental | student_room | hourly_space`, rental mode `nightly | daily | hourly`, status
`draft → inspected → live → paused`), `listing_photos` (ordered, `photographed_by_us`, date), `inspections`
(checklist JSON), `price_rules` (base / weekday_uplift / season with priority and min nights), `los_discounts`,
`calendar_blocks` (booking / owner_block / ical_import), `ical_feeds`, `guests` (ID verification **result**
plus last 4 characters only), `bookings` (nightly snapshot JSON, fee, deposit, policy and commission snapshots),
`payments` (charge / deposit authorisation), `deposit_holds`, `payouts`, `refunds`, `reviews` (one per booking
and side), `issues`, `audit_log` (every money movement), `message_log`, `webhook_events`, `photo_blobs`.

## No double booking

All occupancy is one table, `calendar_blocks`, with half-open `[start, end)` dates, so the check-out day can
be the next check-in. SQLite triggers abort with `DATES_TAKEN` when:
- a `booking` block overlaps any active block, or
- an `owner_block` overlaps a booking.

Imported events may overlap, because they already happened elsewhere; they're flagged as `conflict` for
admins. Holds are created inside `BEGIN IMMEDIATE`: lapsed holds are swept first, then the booking and its
block are inserted. A test fires 20 worker threads at overlapping dates and exactly one wins. For Postgres, use
`EXCLUDE USING gist (listing_id WITH =, daterange(start_date, end_date) WITH &&) WHERE (status = 'active')`.

## Pricing

`priceNight` picks the highest-priority rule by type precedence: season beats weekday uplift beats base. A
season covering a weekend wins. Uplift prices round to the nearest 50 EGP (3,800 + 18% → 4,500). Min nights is
the largest minimum among the stay's nights (2, or 3 in season). The length-of-stay discount (weekly 10%)
applies after nightly pricing. Every booking stores the nightly breakdown, policy and commission as they were
at booking time.

## Calendar sync (iCal)

- **Export:** `/api/ical/<token>.ics`. The token is random per listing plus an HMAC suffix, so it's
  unguessable and can be rotated.
- **Import:** `ical_feeds`, synced every 15 minutes by the scheduler, via "زامن الآن", and again right before a
  hold if the feed is older than 5 minutes. Idempotent by (feed, UID): new events block dates, moved events
  move, events that disappear free their dates. A failing or stale feed is shown in the owner and admin
  dashboards and audited.
- **Delays by nature:** Airbnb and Booking.com publish all-day `VEVENT`s and fetch our export on their own
  schedule, typically every few hours, which we can't control. A double booking can still happen between
  syncs. Mitigations:
  1. Sync on demand before every booking.
  2. Short automatic sync interval.
  3. Conflict flagging and admin alert.
  4. Advise owners to block on the other platforms when they accept outside bookings.

  I couldn't check Airbnb's and Booking.com's current iCal documentation from here, so re-verify the polling
  intervals before launch.

## Money flow (Paymob)

1. Guest pays the stay plus a 5% service fee (wallet payments include the deposit).
2. Booking is confirmed **only** by the HMAC-verified, idempotent webhook.
3. Card deposit: recorded as an authorisation, voided on release. Wallet deposit: refunded on release.
4. Payout `held` → `releasable` when the guest taps "استلمت الشاليه", or 6 hours after check-in time with no
   issue → `paid` in the admin batch. An open issue sets it `frozen`.
5. Deposit is released `deposit_return_days - 1` days after check-out unless the owner reports damage.
6. Cancellation refunds come from the policy snapshot:
   - flexible: 100% until 24h before
   - moderate: 100% more than 14 days before, 50% more than 7 days before
   - strict: 50% more than 30 days before

   The owner keeps the commission-adjusted share of non-refunded nights. An owner or platform cancellation
   always refunds in full.

Paymob auth/capture for deposits needs a separate auth-enabled integration; confirm it with Paymob (TODO.md).

## Messages (WhatsApp templates, Arabic)

`booking_confirmed`, `arrival_details` (address, map pin, handover contact and house rules, sent the evening
before and only after payment), `checkin_prompt`, `checkout_reminder`, `deposit_returned`, `review_request`,
`booking_cancelled`. Without `WHATSAPP_TOKEN` they're simulated and listed under Admin → الرسائل.

## Supply-only mode

`platform_settings.launched = 0` hides search and listing pages from the public (admins still see them) until
the first 30–50 units are inspected. The demo seed sets it to 1.
