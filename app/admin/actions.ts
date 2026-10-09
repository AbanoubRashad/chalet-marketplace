"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run } from "@/lib/db";
import { MarketError } from "@/market/booking";
import { manualBooking, setListingStatus } from "@/market/admin";
import { payReleasable, resolveIssue, runDueJobs } from "@/market/stay";
import { syncAllFeeds } from "@/market/ical";
import { audit } from "@/market/repo";
import { db } from "@/server/db";
import { requireRole } from "@/server/session";

async function act(back: string, fn: (actor: { userId: number; name: string }) => Promise<string | void> | string | void) {
  const { actor } = await requireRole(["admin"]);
  let q: string;
  try {
    q = `ok=${encodeURIComponent((await fn(actor)) || "تم")}`;
  } catch (err) {
    q = `err=${encodeURIComponent(err instanceof MarketError ? (err.message !== err.code ? err.message : err.code) : "حصلت مشكلة")}`;
    if (!(err instanceof MarketError)) console.error(err);
  }
  revalidatePath("/admin", "layout");
  redirect(`${back}?${q}`);
}

export async function listingStatusAction(f: FormData) {
  await act("/admin", (a) => setListingStatus(db(), a, Number(f.get("id")), String(f.get("status")) as "live"));
}
export async function resolveAction(f: FormData) {
  await act("/admin", (a) => resolveIssue(db(), Number(f.get("id")), a, String(f.get("resolution")) as "pay_owner", Number(f.get("amount") || 0), String(f.get("note") ?? "")).then(() => "البلاغ اتقفل"));
}
export async function payoutBatchAction() {
  await act("/admin", (a) => {
    const r = payReleasable(db(), a);
    return r.count ? `اتحوّل ${r.count} مستحق (${r.total.toLocaleString("ar-EG")} ج.م) · دفعة ${r.batch}` : "مفيش مستحقات جاهزة للتحويل";
  });
}
export async function syncAllAction() {
  await act("/admin", async () => `اتزامن ${(await syncAllFeeds(db())).length} تقويم`);
}
export async function runJobsAction() {
  await act("/admin", async () => `المهام: ${JSON.stringify(await runDueJobs(db(), new Date(), { syncFeeds: false }))}`);
}
export async function settingsAction(f: FormData) {
  await act("/admin", (a) => {
    const n = (k: string) => Number(f.get(k));
    run(
      db(),
      "UPDATE platform_settings SET launched = ?, require_guest_id = ?, service_fee_pct = ?, commission_pct = ?, managed_pct = ?, payout_release_hours = ?, deposit_return_days = ?, ical_sync_minutes = ? WHERE id = 1",
      f.get("launched") === "on" ? 1 : 0,
      f.get("require_guest_id") === "on" ? 1 : 0,
      n("service_fee_pct"),
      n("commission_pct"),
      n("managed_pct"),
      n("payout_release_hours"),
      n("deposit_return_days"),
      n("ical_sync_minutes"),
    );
    audit(db(), a, "settings.updated", "platform_settings", 1);
  });
}
export async function manualAction(f: FormData) {
  await act("/admin/manual", (a) => {
    const b = manualBooking(db(), a, {
      listingId: Number(f.get("listing")),
      checkIn: String(f.get("in")),
      checkOut: String(f.get("out")),
      guests: Number(f.get("guests")),
      name: String(f.get("name") ?? ""),
      phone: String(f.get("phone") ?? ""),
    });
    return `اتعمل الحجز ${b.ref}`;
  });
}
export async function demoFeedAction(f: FormData) {
  await act("/admin/demo-feed", () => {
    if (f.get("op") === "delete") run(db(), "DELETE FROM demo_feed_events WHERE id = ?", Number(f.get("id")));
    else {
      const from = String(f.get("from"));
      const to = String(f.get("to"));
      if (!(to > from)) throw new MarketError("INVALID_DATES", "تاريخ المغادرة لازم يكون بعد الوصول");
      run(db(), "INSERT INTO demo_feed_events (feed_key, uid, start_date, end_date, summary) VALUES ('airbnb-nawras', ?, ?, ?, ?)", `airbnb-${Date.now()}`, from, to, `Reserved · ${String(f.get("guest") || "Airbnb guest")}`);
    }
    return "اتعدل تقويم Airbnb التجريبي. اضغط «زامن الآن» من لوحة المالك أو استنى المزامنة التلقائية.";
  });
}
