import { weekdayOf, zonedToUtc } from "./time";

/** Half-open interval [start, end) in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

/** A recurring weekly window when a resource (doctor, room, chalet...) is bookable at a location. */
export interface WorkingWindow {
  weekday: number; // 0 = Sunday
  startMin: number; // minutes after local midnight
  endMin: number;
  locationId: number;
}

export interface SlotQuery {
  timezone: string;
  dates: string[]; // local dates (YYYY-MM-DD)
  locationId: number;
  windows: WorkingWindow[];
  /** Everything that blocks the resource: time off, existing bookings (incl. their buffer), active holds, at any location. */
  blocked: Interval[];
  durationMin: number;
  bufferMin: number;
  stepMin: number;
  now: Date;
  minNoticeMin: number;
}

export interface Slot {
  date: string;
  startMin: number;
  start: Date;
  end: Date;
  /** end + buffer: the time the resource is actually occupied. */
  blockEnd: Date;
  available: boolean;
}

/**
 * Availability = working windows − blocked intervals, sliced by duration on a fixed step.
 * Past slots and slots inside the minimum notice are omitted entirely; slots that collide with
 * a blocked interval are returned with available=false so UIs can show them as taken.
 */
export function generateSlots(q: SlotQuery): Slot[] {
  const earliest = q.now.getTime() + q.minNoticeMin * 60_000;
  const out: Slot[] = [];
  for (const date of q.dates) {
    const wd = weekdayOf(date);
    const seen = new Set<number>();
    const windows = q.windows
      .filter((w) => w.weekday === wd && w.locationId === q.locationId)
      .sort((a, b) => a.startMin - b.startMin);
    for (const w of windows) {
      for (let m = w.startMin; m + q.durationMin <= w.endMin; m += q.stepMin) {
        if (seen.has(m)) continue;
        seen.add(m);
        const start = zonedToUtc(date, m, q.timezone);
        if (start.getTime() < earliest) continue;
        const end = new Date(start.getTime() + q.durationMin * 60_000);
        const blockEnd = new Date(end.getTime() + q.bufferMin * 60_000);
        const s = start.getTime();
        const e = blockEnd.getTime();
        const available = !q.blocked.some((b) => b.start < e && b.end > s);
        out.push({ date, startMin: m, start, end, blockEnd, available });
      }
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && a.end > b.start;
}
