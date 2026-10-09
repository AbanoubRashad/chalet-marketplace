# Confirm with a lawyer / tax advisor before launch

None of this is legal advice. Every item below is a **setting or a document**, not hard-coded behaviour.

| Topic | Question to confirm | Where it lives in the app |
|---|---|---|
| Holiday-rental licensing | Do owners or the platform need a tourism or holiday-rental licence (Ministry of Tourism, governorate, compound management) to rent short-term in North Coast / Ain Sokhna compounds? Are there compound bylaws that ban short lets? | `platform_settings.tourism_license_required`; owner agreement text; listing checklist |
| VAT and tax on commissions | VAT rate on our commission and service fee; withholding tax on owner payouts; e-invoicing (ETA) obligations | `platform_settings.vat_on_commission_pct`; monthly owner statement |
| Guest registration | Do hosts or compounds have to register guests (names and ID numbers) with the police or compound security? Who's responsible: owner, platform or compound? | Handover instructions; `require_guest_id` |
| ID data retention | Lawful basis and retention period for ID verification results under Egypt's Personal Data Protection Law (151/2020); whether storing the verification reference plus last 4 digits is enough | `platform_settings.id_data_retention_days`; `guests.id_*` (no images or full numbers stored) |
| Payments and escrow | Is holding guest funds until check-in allowed under our Paymob merchant setup / CBE rules, or do we need a payment-facilitator / escrow arrangement? | Payout states (`held → releasable → paid`) |
| Security deposits | Card pre-authorisation duration limits and refund timelines | `deposit_holds` |
| Consumer protection | Cancellation policy wording and refund timelines (Consumer Protection Law 181/2018) | `POLICY_TEXT`, policies page |
| Reviews | Rules on publishing guest reviews and owner replies; takedown process | `reviews` |
| Marketing messages | WhatsApp opt-in rules and template categories (Meta) | messaging layer, opt-out |
