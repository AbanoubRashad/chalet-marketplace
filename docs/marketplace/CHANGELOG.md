# Changelog

## 0.1.1 (2026-10-09)

- Fonts use `display: optional`. The El Messiri headline swap pushed the search bar down (CLS 0.17 → 0).
- Filter chips are links, so they use `aria-current` instead of `aria-pressed`.
- Live mobile Lighthouse: performance 96, accessibility 100, best practices 100, SEO 100.

## 0.1.0 (2026-10-09)

- **Phase 1, supply:** inspector role with phone photo upload (ordered, "photographed by us"), checklist,
  draft → inspected; owner onboarding (account, identity, payout details, plan, agreement); supply-only mode.
- **Phase 2, pricing and availability:** booking engine extended with nightly mode (season > weekday uplift >
  base, min nights per period, weekly discount); half-open date blocks; DB trigger against double booking;
  20-way concurrency test.
- **Phase 3, calendar sync:** signed iCal export; idempotent import by UID (add, move, remove); every-15-minutes
  sync plus "sync now" plus pre-booking re-check; conflicts and stale feeds surfaced; demo Airbnb feed.
- **Phase 4, money:** Paymob charge with verified, idempotent webhook; deposit authorisation (card) or
  collection (wallet); payout held → releasable (check-in tap, or 6 hours) → paid batch; issue freezes
  payout; policy-snapshot refunds; commission vs managed plan; monthly owner statement; audit log of money
  movements.
- **Phase 5, guests:** search by region, dates, guests and filter chips (only available units, with the
  stay total); 390px chalet page with tiered date picker and live breakdown; ID check before first booking;
  trip page (status steps, arrival details after payment, "استلمت الشاليه", report issue, cancel with refund
  preview, verified review); WhatsApp template messages.
- **Phase 6, dashboards:** owner calendar by source with click-to-block, pricing editor, bookings and payouts,
  iCal panel, deposit and policy, plan switch, review replies; admin pipeline, disputes, payout batch, feed
  health, settings, manual booking for the managed plan.
