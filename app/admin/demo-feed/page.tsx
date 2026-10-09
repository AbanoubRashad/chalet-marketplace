import { all } from "@/lib/db";
import { Flash } from "@/components/ui";
import { fmtRange } from "@/market/format";
import { db } from "@/server/db";
import { requireRole } from "@/server/session";
import { demoFeedAction } from "../actions";

export const dynamic = "force-dynamic";

/** Demo stand-in for Airbnb's iCal export of the Nawras chalet: add or delete an event, then sync. */
export default async function DemoFeed({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  await requireRole(["admin"]);
  const events = all<{ id: number; uid: string; start_date: string; end_date: string; summary: string }>(db(), "SELECT * FROM demo_feed_events WHERE feed_key = 'airbnb-nawras' ORDER BY start_date");
  return (
    <>
      <div className="dash-top">
        <div>
          <h1>محاكي Airbnb (تقويم النورس)</h1>
          <div className="muted">
            ده بيمثّل رابط iCal اللي Airbnb بيصدّره. ضيف حجز هنا، زامن من لوحة المالك، والأيام هتتقفل. امسحه وزامن، والأيام هتتفتح. الرابط: <span dir="ltr">/api/demo-feeds/airbnb-nawras.ics</span>
          </div>
        </div>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      <section className="panel">
        {events.map((e) => (
          <div key={e.id} className="row-line">
            <span>
              {fmtRange(e.start_date, e.end_date)} · {e.summary} <span className="muted" style={{ fontSize: 12 }} dir="ltr">{e.uid}</span>
            </span>
            <form action={demoFeedAction}>
              <input type="hidden" name="op" value="delete" />
              <input type="hidden" name="id" value={e.id} />
              <button className="pill sm danger" type="submit">
                امسح
              </button>
            </form>
          </div>
        ))}
        <form action={demoFeedAction} className="form-grid" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <label className="field">
            الوصول
            <input type="date" name="from" required />
          </label>
          <label className="field">
            المغادرة
            <input type="date" name="to" required />
          </label>
          <label className="field">
            اسم الضيف
            <input name="guest" placeholder="John D." />
          </label>
          <button className="pill dark" type="submit">
            أضف حجز على Airbnb
          </button>
        </form>
      </section>
    </>
  );
}
