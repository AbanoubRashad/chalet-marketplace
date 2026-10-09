import { generateSlots, type Interval, type Slot, type WorkingWindow } from "./availability";
import { SlotUnavailableError } from "./errors";
import { utcToZoned } from "./time";

/** Everything the engine needs to know about one bookable (resource × service × location). */
export interface BookableContext {
  timezone: string;
  durationMin: number;
  bufferMin: number;
  stepMin: number;
  minNoticeMin: number;
  windows: WorkingWindow[];
}

export interface BookableKey {
  tenantId: number;
  resourceId: number;
  serviceId: number;
  locationId: number;
}

export interface HoldRequest extends BookableKey {
  start: Date;
  end: Date;
  blockEnd: Date;
  expiresAt: Date;
  /** The engine's clock; stores sweep holds that expired before this instant before inserting. */
  now: Date;
  meta: Record<string, unknown>;
}

/**
 * Persistence port. Implementations MUST make insertHold atomic and reject overlaps at the
 * database level (throwing SlotTakenError), so correctness never depends on a prior read.
 */
export interface BookingStore<THold> {
  loadContext(key: BookableKey): BookableContext | null;
  /** Blocks for the resource at any location, plus location-wide closures for key.locationId. */
  blockedIntervals(key: BookableKey, from: Date, to: Date, now: Date): Interval[];
  insertHold(req: HoldRequest): THold;
  expireHolds(now: Date): number;
}

export function createBookingEngine<THold>(store: BookingStore<THold>) {
  function availability(key: BookableKey, dates: string[], now: Date = new Date()): Slot[] {
    const ctx = store.loadContext(key);
    if (!ctx || dates.length === 0) return [];
    const sorted = [...dates].sort();
    // Pad by a day each side so cross-midnight blocks and tz offsets are covered.
    const from = new Date(Date.parse(`${sorted[0]}T00:00:00Z`) - 86_400_000);
    const to = new Date(Date.parse(`${sorted[sorted.length - 1]}T00:00:00Z`) + 2 * 86_400_000);
    const blocked = store.blockedIntervals(key, from, to, now);
    return generateSlots({ ...ctx, dates, locationId: key.locationId, blocked, now });
  }

  /** Re-validates the requested start against live availability, then reserves it atomically. */
  function placeHold(
    key: BookableKey,
    start: Date,
    opts: { holdMinutes: number; now?: Date; meta?: Record<string, unknown> },
  ): THold {
    const now = opts.now ?? new Date();
    const ctx = store.loadContext(key);
    if (!ctx) throw new SlotUnavailableError("Unknown resource/service/location");
    const { date } = utcToZoned(start, ctx.timezone);
    const slot = availability(key, [date], now).find((s) => s.start.getTime() === start.getTime());
    if (!slot) throw new SlotUnavailableError();
    // Even if the slot looked free a moment ago, the store's DB constraint is the final word.
    return store.insertHold({
      ...key,
      start: slot.start,
      end: slot.end,
      blockEnd: slot.blockEnd,
      expiresAt: new Date(now.getTime() + opts.holdMinutes * 60_000),
      now,
      meta: opts.meta ?? {},
    });
  }

  return { availability, placeHold, expireHolds: (now: Date = new Date()) => store.expireHolds(now) };
}
