# Deferred

| Item | Why |
|---|---|
| Merge into Manhal and share one `booking-engine` package with the clinic portal | Manhal isn't here. The engine is copied with the clinic version untouched plus `nightly.ts`; publish it as a workspace package when merging. |
| Paymob deposit pre-authorisation (auth/capture/void) | Needs an auth-enabled Paymob integration and their current docs. Simulated: recorded as `authorized`, voided on release. |
| Real KYC provider for guest and owner ID checks | Vendor not chosen. A checksum and format check stands in, storing result plus reference plus last 4 only. |
| WhatsApp Business templates and webhook for replies | Needs a Meta account and template approval. Messages are logged instead. |
| English UI | The brief says "English later via i18n keys". All copy is in components and `format.ts`, ready to move into a dictionary. |
| Image processing for uploads (resize, EXIF strip) | Photos are stored as uploaded. Add `sharp` resizing and EXIF stripping before launch. |
| Payout bank transfers | The admin "pay batch" marks payouts paid; connect a bank/InstaPay disbursement API. |
| Legal sign-off | See COMPLIANCE.md. |
| Hourly / daily rental UIs (studios, padel, استراحات) | The data model and engine support them (`rental_mode`, time-slot engine); only `chalet` / `villa` are enabled in the UI. |
| Multi-instance scheduler | In-process every minute. Use a queue/cron when scaling out. |
