const AR = "٠١٢٣٤٥٦٧٨٩";
export const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export const WEEKDAYS_AR = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
export const WEEKDAYS_SHORT_AR = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

export const ar = (v: string | number) => String(v).replace(/\d/g, (d) => AR[Number(d)]!);
export const fmtNum = (n: number) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 1 }).format(n);
export const fmtMoney = (n: number) => `${fmtNum(n)} ج.م`;
export const fmtRating = (n: number | null) => (n == null ? "" : new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n));

function parts(d: string) {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return { y, m, day, wd: new Date(Date.UTC(y, m - 1, day)).getUTCDay() };
}
export const fmtDateShort = (d: string) => {
  const p = parts(d);
  return `${ar(p.day)} ${MONTHS_AR[p.m - 1]}`;
};
export const fmtDateLong = (d: string) => {
  const p = parts(d);
  return `${WEEKDAYS_AR[p.wd]} ${ar(p.day)} ${MONTHS_AR[p.m - 1]} ${ar(p.y)}`;
};
export const fmtMonth = (ym: string) => `${MONTHS_AR[Number(ym.slice(5, 7)) - 1]} ${ar(ym.slice(0, 4))}`;
/** "٣–٦ أغسطس" or "٢٨ يوليو – ٢ أغسطس" */
export function fmtRange(a: string, b: string) {
  const pa = parts(a);
  const pb = parts(b);
  if (pa.m === pb.m && pa.y === pb.y) return `${ar(pa.day)}–${ar(pb.day)} ${MONTHS_AR[pa.m - 1]}`;
  return `${fmtDateShort(a)} – ${fmtDateShort(b)}`;
}
export const nightsWord = (n: number) => (n === 1 ? "ليلة" : n === 2 ? "ليلتين" : `${ar(n)} ${n <= 10 ? "ليالي" : "ليلة"}`);
export const TIER_AR = { regular: { short: "ع", name: "ليلة عادية" }, weekend: { short: "و", name: "ليلة ويك إند" }, season: { short: "م", name: "ليلة موسم" } } as const;
