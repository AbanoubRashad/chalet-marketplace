// Guest/owner messages. Template names mirror pre-approved WhatsApp templates (utility category).
import { get, type DB } from "@/lib/db";
import { decryptField } from "@/lib/crypto";
import { sendMessage } from "@/messaging";
import { localFormat } from "@/lib/phone";
import { fmtDateShort, fmtMoney } from "./format";
import type { Booking, Guest, Listing } from "./types";

export type Template =
  | "booking_confirmed"
  | "arrival_details"
  | "checkin_prompt"
  | "checkout_reminder"
  | "deposit_returned"
  | "review_request"
  | "booking_cancelled"
  | "owner_new_booking";

function phoneOf(enc: string | null | undefined) {
  if (!enc) return "";
  try {
    return decryptField(enc);
  } catch {
    return "";
  }
}

export function renderMessage(t: Template, ctx: { g: Guest; l: Listing & { compound_ar?: string }; b: Booking; origin: string; extra?: Record<string, unknown> }) {
  const { g, l, b, origin } = ctx;
  const first = g.name.split(" ")[0];
  const stay = `${fmtDateShort(b.check_in)} → ${fmtDateShort(b.check_out)}`;
  const trip = `${origin}/trips/${b.public_token}`;
  switch (t) {
    case "booking_confirmed":
      return `أهلًا ${first}، حجزك في «${l.title_ar}» مؤكد (${stay}) · رقم الحجز ${b.ref}. فلوسك محفوظة عندنا لحد يوم الوصول. تفاصيل رحلتك: ${trip}`;
    case "arrival_details":
      return `أهلًا ${first}، وصولك بكرة. العنوان: ${l.address_private}. الموقع: https://maps.google.com/?q=${l.lat},${l.lng} · المسؤول عن الاستلام: ${l.handover_name} ${localFormat(phoneOf(l.handover_phone_enc))}. قواعد الوحدة: ${l.house_rules_ar}`;
    case "checkin_prompt":
      return `أهلًا ${first}، أول ما تستلم الشاليه اضغط «استلمت الشاليه»، أو بلّغنا بأي مشكلة خلال ٦ ساعات: ${trip}`;
    case "checkout_reminder":
      return `أهلًا ${first}، تذكير: الخروج النهارده الساعة ١٢ ظهرًا. سلّم المفتاح لـ ${l.handover_name}. التأمين بيرجع لك خلال ٣ أيام لو مفيش ملاحظات.`;
    case "deposit_returned":
      return `أهلًا ${first}، رجعنالك مبلغ التأمين ${fmtMoney(b.security_deposit)}. شكرًا لإقامتك في «${l.title_ar}».`;
    case "review_request":
      return `أهلًا ${first}، إيه رأيك في إقامتك في «${l.title_ar}»؟ تقييمك بيساعد العائلات الجاية: ${trip}`;
    case "booking_cancelled":
      return `أهلًا ${first}، تم إلغاء حجزك ${b.ref}. ${Number(ctx.extra?.refund ?? 0) > 0 ? `هيرجع لك ${fmtMoney(Number(ctx.extra?.refund))} خلال ٥–٧ أيام عمل.` : "حسب سياسة الإلغاء مفيش مبلغ مسترد."}`;
    case "owner_new_booking":
      return `حجز جديد مؤكد في «${l.title_ar}»: ${stay} · ${b.guests_count} أفراد · مستحقك ${fmtMoney(b.owner_payout)} (محفوظ لحد وصول الضيف).`;
  }
}

export async function notify(db: DB, b: Booking, t: Template, extra?: Record<string, unknown>) {
  if (!b.guest_id) return;
  const g = get<Guest>(db, "SELECT * FROM guests WHERE id = ?", b.guest_id)!;
  const l = get<Listing>(db, "SELECT * FROM listings WHERE id = ?", b.listing_id)!;
  const origin = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  const body = renderMessage(t, { g, l, b, origin, extra });
  return sendMessage(db, {
    tenantId: 1,
    template: t,
    lang: "ar",
    to: phoneOf(g.phone_enc),
    email: g.email,
    params: [g.name, b.ref],
    body,
    optedOut: Boolean(g.whatsapp_opt_out),
    bookingId: b.id,
    guestId: g.id,
  });
}
