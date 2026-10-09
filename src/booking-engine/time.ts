// Timezone helpers built on Intl, so DST rules come from the platform tz database.
// (Egypt re-introduced summer time in 2023: last Friday of April -> last Thursday of October.)

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function zonedParts(date: Date, tz: string) {
  const p: Record<string, number> = {};
  for (const part of partsFormatter(tz).formatToParts(date)) if (part.type !== "literal") p[part.type] = Number(part.value);
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour! % 24, mi: p.minute!, s: p.second! };
}

/** Offset of tz from UTC at the given instant, in minutes (Cairo: +120 or +180). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** Local wall-clock (date + minutes after midnight) in tz -> UTC instant. */
export function zonedToUtc(localDate: string, minutes: number, tz: string): Date {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  let utc = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2 * 60000;
  return new Date(utc);
}

/** UTC instant -> local date, minutes after midnight and weekday (0 = Sunday) in tz. */
export function utcToZoned(date: Date, tz: string): { date: string; minutes: number; weekday: number } {
  const p = zonedParts(date, tz);
  const ds = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  return { date: ds, minutes: p.h * 60 + p.mi, weekday: weekdayOf(ds) };
}

export function weekdayOf(localDate: string): number {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(localDate: string, n: number): string {
  const [y, m, d] = localDate.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function todayIn(tz: string, now: Date = new Date()): string {
  return utcToZoned(now, tz).date;
}

export function dateRange(from: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => addDays(from, i));
}
