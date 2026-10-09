import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { all } from "@/lib/db";
import { Flash, Icon } from "@/components/ui";
import { addPhoto, CHECKLIST, deletePhoto, movePhoto, submitInspection } from "@/market/admin";
import { MarketError } from "@/market/booking";
import { ar, fmtDateShort } from "@/market/format";
import { listingCard, photos } from "@/market/repo";
import { db } from "@/server/db";
import { requireRole } from "@/server/session";

export const dynamic = "force-dynamic";

async function guard(id: number, fn: (actor: { userId: number; name: string }) => unknown, ok: string) {
  const { actor } = await requireRole(["inspector", "admin"]);
  let q = `ok=${encodeURIComponent(ok)}`;
  try {
    await fn(actor);
  } catch (err) {
    q = `err=${encodeURIComponent(err instanceof MarketError ? err.message : "حصلت مشكلة")}`;
  }
  revalidatePath(`/inspector/${id}`);
  redirect(`/inspector/${id}?${q}`);
}

async function upload(f: FormData) {
  "use server";
  const id = Number(f.get("id"));
  const files = f.getAll("photos").filter((x): x is File => x instanceof File && x.size > 0);
  await guard(id, async (actor) => {
    if (!files.length) throw new MarketError("INVALID_STATE", "اختار صور الأول");
    for (const file of files) addPhoto(db(), actor, id, { mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
  }, `اترفعت ${files.length} صور`);
}
async function move(f: FormData) {
  "use server";
  const id = Number(f.get("id"));
  await guard(id, () => movePhoto(db(), id, Number(f.get("photo")), f.get("dir") === "up" ? -1 : 1), "اتغير الترتيب");
}
async function remove(f: FormData) {
  "use server";
  const id = Number(f.get("id"));
  await guard(id, () => deletePhoto(db(), id, Number(f.get("photo"))), "اتمسحت الصورة");
}
async function inspect(f: FormData) {
  "use server";
  const id = Number(f.get("id"));
  const checks = Object.fromEntries(CHECKLIST.map(([k]) => [k, f.get(k) === "on"]));
  let passed = false;
  await guard(id, (actor) => {
    passed = submitInspection(db(), actor, id, checks, String(f.get("notes") ?? ""));
  }, "اتسجلت المعاينة");
  void passed;
}

export default async function InspectListing({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  await requireRole(["inspector", "admin"]);
  const d = db();
  const c = listingCard(d, id);
  if (!c) notFound();
  const pics = photos(d, id);
  const last = all<{ checklist: string; notes: string; passed: number; inspected_at: string }>(d, "SELECT * FROM inspections WHERE listing_id = ? ORDER BY id DESC LIMIT 1", id)[0];
  const lastChecks = last ? (JSON.parse(last.checklist) as Record<string, boolean>) : {};
  return (
    <>
      <div className="dash-top">
        <div>
          <Link href="/inspector" prefetch={false}>
            ← الوحدات
          </Link>
          <h1>{c.title_ar}</h1>
          <div className="muted">
            {c.compound_ar} · كم {ar(c.km_marker ?? 0)} · <span className="tag">{c.status}</span>
          </div>
        </div>
      </div>
      <Flash ok={sp.ok} err={sp.err} />
      <section className="panel" aria-labelledby="ph">
        <h2 id="ph">١. الصور (بالترتيب اللي هيظهر للضيف)</h2>
        <form action={upload} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <input type="hidden" name="id" value={id} />
          <label className="pill" style={{ cursor: "pointer" }}>
            <Icon name="camera" /> صوّر أو اختار صور
            <input type="file" name="photos" accept="image/jpeg,image/png,image/webp" capture="environment" multiple className="sr-only" />
          </label>
          <button className="pill dark" type="submit">
            ارفع
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            كل صورة بتتعلّم «صورة فريقنا» بتاريخ النهارده.
          </span>
        </form>
        <div className="photo-grid">
          {pics.map((p, i) => (
            <figure key={p.id}>
              <img src={p.url} alt={`صورة ${i + 1}`} />
              <figcaption>
                <span>{ar(i + 1)}</span>
                <span style={{ display: "flex", gap: 2 }}>
                  {[
                    ["up", "↑", "قدّم"],
                    ["down", "↓", "أخّر"],
                  ].map(([dir, sym, label]) => (
                    <form key={dir} action={move}>
                      <input type="hidden" name="id" value={id} />
                      <input type="hidden" name="photo" value={p.id} />
                      <input type="hidden" name="dir" value={dir} />
                      <button type="submit" aria-label={label} className="pill sm" style={{ minHeight: 30, paddingInline: 8 }}>
                        {sym}
                      </button>
                    </form>
                  ))}
                  <form action={remove}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="photo" value={p.id} />
                    <button type="submit" aria-label="امسح" className="pill sm danger" style={{ minHeight: 30, paddingInline: 8 }}>
                      ×
                    </button>
                  </form>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
      <form action={inspect} className="panel" aria-labelledby="cl">
        <h2 id="cl">٢. قائمة الفحص</h2>
        <input type="hidden" name="id" value={id} />
        {CHECKLIST.map(([k, label]) => (
          <label key={k} className="check" style={{ borderTop: "1px solid var(--line)" }}>
            <input type="checkbox" name={k} defaultChecked={Boolean(lastChecks[k])} /> {label}
          </label>
        ))}
        <label className="field">
          ملاحظات
          <textarea name="notes" rows={2} defaultValue={last?.notes ?? ""} />
        </label>
        <button className="pill sea lg" type="submit">
          اعتمد المعاينة
        </button>
        {last ? (
          <div className="muted" style={{ fontSize: 13 }}>
            آخر معاينة: {fmtDateShort(last.inspected_at.slice(0, 10))} · {last.passed ? "ناجحة" : "محتاجة تصليحات"}
          </div>
        ) : null}
      </form>
    </>
  );
}
