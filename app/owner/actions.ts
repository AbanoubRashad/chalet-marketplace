"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { get, run } from "@/lib/db";
import { encryptField } from "@/lib/crypto";
import { MarketError, cancelBooking } from "@/market/booking";
import { addFeed, addSeason, removeRule, saveDepositPolicy, savePricing, setPlan, syncListingFeeds, toggleNight } from "@/market/owner";
import { openIssue, ownerReply } from "@/market/stay";
import { audit, ownerScope } from "@/market/repo";
import { db } from "@/server/db";
import { requireOwner } from "@/server/session";

const MSG: Record<string, string> = {
  DATES_TAKEN: "اليوم ده عليه حجز، مينفعش يتقفل.",
  FORBIDDEN: "مش مسموح.",
  INVALID_STATE: "الإجراء ده مش متاح.",
};

function back(f: FormData) {
  const b = String(f.get("back") ?? "/owner");
  return b.startsWith("/owner") ? b : "/owner";
}
function flash(url: string, key: "ok" | "err", msg: string) {
  const u = new URL(url, "http://x");
  u.searchParams.delete("ok");
  u.searchParams.delete("err");
  u.searchParams.set(key, msg);
  return `${u.pathname}${u.search}`;
}

async function act(f: FormData, fn: (o: Awaited<ReturnType<typeof requireOwner>>) => Promise<string | void> | string | void) {
  const ctx = await requireOwner();
  let r: ["ok" | "err", string];
  try {
    r = ["ok", (await fn(ctx)) || "تم الحفظ"];
  } catch (err) {
    r = ["err", err instanceof MarketError ? (err.message !== err.code ? err.message : (MSG[err.code] ?? err.code)) : "حصلت مشكلة"];
    if (!(err instanceof MarketError)) console.error(err);
  }
  revalidatePath("/owner", "layout");
  redirect(flash(back(f), r[0], r[1]));
}

const num = (f: FormData, k: string) => Number(String(f.get(k) ?? "").replace(/[^\d.]/g, ""));
const lid = (f: FormData) => Number(f.get("listing"));

export async function toggleNightAction(f: FormData) {
  await act(f, ({ owner, actor }) => (toggleNight(db(), owner.id, lid(f), String(f.get("date")), actor) === "blocked" ? "اليوم اتقفل" : "اليوم اتفتح للحجز"));
}
export async function planAction(f: FormData) {
  await act(f, ({ owner, actor }) => {
    setPlan(db(), owner.id, f.get("plan") === "managed" ? "managed" : "commission", actor);
    return "الخطة اتغيرت وهتطبق على الحجوزات الجديدة";
  });
}
export async function pricingAction(f: FormData) {
  await act(f, ({ owner, actor }) =>
    savePricing(db(), owner.id, lid(f), { base: num(f, "base"), baseMin: num(f, "baseMin") || 1, upliftPct: num(f, "uplift"), upliftDays: f.getAll("days").map(Number), weeklyPct: num(f, "weekly") }, actor),
  );
}
export async function seasonAction(f: FormData) {
  await act(f, ({ owner, actor }) => addSeason(db(), owner.id, lid(f), { label: String(f.get("label") ?? ""), from: String(f.get("from")), to: String(f.get("to")), amount: num(f, "amount"), minNights: num(f, "minNights") }, actor));
}
export async function removeSeasonAction(f: FormData) {
  await act(f, ({ owner, actor }) => removeRule(db(), owner.id, lid(f), Number(f.get("rule")), actor));
}
export async function depositAction(f: FormData) {
  await act(f, ({ owner, actor }) => saveDepositPolicy(db(), owner.id, lid(f), num(f, "deposit"), String(f.get("policy")), actor));
}
export async function feedAction(f: FormData) {
  await act(f, async ({ owner, actor }) => {
    addFeed(db(), owner.id, lid(f), String(f.get("provider")), String(f.get("url") ?? "").trim(), actor);
    await syncListingFeeds(db(), owner.id, lid(f));
    return "اتربط الرابط واتعملت مزامنة";
  });
}
export async function syncAction(f: FormData) {
  await act(f, async ({ owner }) => {
    const r = await syncListingFeeds(db(), owner.id, lid(f));
    const err = r.find((x) => x.error);
    if (err) throw new MarketError("INVALID_STATE", `فشلت المزامنة: ${err.error}`);
    const t = r.reduce((s, x) => ({ a: s.a + x.added + x.updated, d: s.d + x.removed, c: s.c + x.conflicts }), { a: 0, d: 0, c: 0 });
    return `تمت المزامنة: ${t.a} تحديث، ${t.d} اتشال${t.c ? ` · ${t.c} تعارض مع حجز على المنصة (فريقنا اتبلّغ)` : ""}`;
  });
}
export async function damageAction(f: FormData) {
  await act(f, ({ owner }) => {
    const b = ownerScope(db(), owner.id).booking(Number(f.get("booking")));
    if (!b) throw new MarketError("FORBIDDEN");
    openIssue(db(), b.id, "owner", "damage", String(f.get("description") ?? ""), String(f.get("evidence") ?? ""));
    return "البلاغ وصل. التأمين هيفضل محجوز لحد ما فريقنا يراجع.";
  });
}
export async function ownerCancelAction(f: FormData) {
  await act(f, async ({ owner, actor }) => {
    const b = ownerScope(db(), owner.id).booking(Number(f.get("booking")));
    if (!b) throw new MarketError("FORBIDDEN");
    await cancelBooking(db(), b.id, "owner", new Date(), actor);
    return "اتلغى الحجز ورجعنا للضيف المبلغ كامل";
  });
}
export async function replyAction(f: FormData) {
  await act(f, ({ owner }) => ownerReply(db(), owner.id, Number(f.get("review")), String(f.get("reply") ?? "")));
}
export async function verificationAction(f: FormData) {
  await act(f, ({ owner, actor }) => {
    const nid = String(f.get("nid") ?? "").replace(/\s/g, "");
    const iban = String(f.get("account") ?? "").replace(/\s/g, "");
    if (!/^[23]\d{13}$/.test(nid)) throw new MarketError("INVALID_STATE", "الرقم القومي لازم يكون ١٤ رقم");
    if (iban.length < 6) throw new MarketError("INVALID_STATE", "اكتب رقم الحساب أو InstaPay");
    run(
      db(),
      "UPDATE owners SET identity_status = 'verified', identity_ref = ?, payout_method = ?, payout_masked = ?, agreement_signed_at = CASE WHEN ? = 'on' THEN COALESCE(agreement_signed_at, ?) ELSE agreement_signed_at END WHERE id = ?",
      `kyc_sim_${nid.slice(-4)}`,
      String(f.get("method") ?? "bank"),
      `${String(f.get("method") ?? "bank") === "instapay" ? "InstaPay" : "Bank"} •••• ${iban.slice(-4)}`,
      String(f.get("agree") ?? ""),
      new Date().toISOString(),
      owner.id,
    );
    if (f.get("handover")) {
      const l = get<{ id: number }>(db(), "SELECT id FROM listings WHERE owner_id = ? ORDER BY id LIMIT 1", owner.id);
      if (l) run(db(), "UPDATE listings SET handover_phone_enc = ? WHERE id = ?", encryptField(String(f.get("handover"))), l.id);
    }
    audit(db(), actor, "owner.verification_submitted", "owner", owner.id);
    return "تم حفظ بيانات التحقق والتحويل";
  });
}
