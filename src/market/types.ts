export type Plan = "commission" | "managed";
export type Policy = "flexible" | "moderate" | "strict";
export type BookingStatus = "hold" | "pending_payment" | "confirmed" | "checked_in" | "completed" | "cancelled" | "disputed";
export type Role = "admin" | "inspector" | "owner";

export interface Settings {
  brand_ar: string;
  brand_en: string;
  support_phone: string;
  timezone: string;
  service_fee_pct: number;
  commission_pct: number;
  managed_pct: number;
  payout_release_hours: number;
  deposit_return_days: number;
  ical_sync_minutes: number;
  ical_stale_minutes: number;
  hold_minutes: number;
  checkin_hour: number;
  checkout_hour: number;
  launched: number;
  require_guest_id: number;
  vat_on_commission_pct: number;
  tourism_license_required: number;
  id_data_retention_days: number;
  demo: number;
}

export interface Listing {
  id: number;
  owner_id: number;
  compound_id: number;
  slug: string;
  title_ar: string;
  title_en: string;
  category: string;
  rental_mode: string;
  capacity: number;
  rooms: number;
  baths: number;
  parking: number;
  beachfront: number;
  pool: number;
  families_only: number;
  pets_allowed: number;
  location_note_ar: string;
  description_ar: string;
  house_rules_ar: string;
  amenities: string;
  address_private: string;
  handover_name: string;
  handover_phone_enc: string | null;
  lat: number | null;
  lng: number | null;
  status: "draft" | "inspected" | "live" | "paused";
  cancellation_policy: Policy;
  security_deposit: number;
  ical_export_token: string;
}

export interface ListingCard extends Listing {
  compound_ar: string;
  km_marker: number | null;
  region_ar: string;
  region_slug: string;
  photo: string | null;
  rating: number | null;
  reviews: number;
  from_price: number;
}

export interface Booking {
  id: number;
  ref: string;
  public_token: string;
  listing_id: number;
  guest_id: number | null;
  check_in: string;
  check_out: string;
  guests_count: number;
  nightly_json: string;
  subtotal: number;
  discount: number;
  nights_total: number;
  service_fee: number;
  total: number;
  security_deposit: number;
  policy: Policy;
  plan: Plan;
  commission_pct: number;
  owner_payout: number;
  status: BookingStatus;
  hold_expires_at: string | null;
  pay_method: "card" | "wallet" | "offline" | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  refund_amount: number;
  created_at: string;
}

export interface Guest {
  id: number;
  name: string;
  phone_enc: string;
  phone_hash: string;
  phone_last4: string;
  email: string | null;
  id_status: "none" | "verified" | "failed";
  id_type: string | null;
  id_ref: string | null;
  id_last4: string | null;
  whatsapp_opt_out: number;
}

export interface Owner {
  id: number;
  user_id: number;
  display_name: string;
  identity_status: "pending" | "verified" | "rejected";
  payout_method: string | null;
  payout_masked: string | null;
  plan: Plan;
  agreement_signed_at: string | null;
}

export const POLICY_TEXT: Record<Policy, { name: string; text: string }> = {
  flexible: { name: "مرنة", text: "استرداد كامل لحد ٢٤ ساعة قبل الوصول." },
  moderate: { name: "متوسطة", text: "استرداد كامل قبل ١٤ يوم، ٥٠٪ قبل ٧ أيام." },
  strict: { name: "صارمة", text: "استرداد ٥٠٪ لو الإلغاء قبل ٣٠ يوم، وبعد كده مفيش استرداد." },
};
