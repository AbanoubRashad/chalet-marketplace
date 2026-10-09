export class SlotTakenError extends Error {
  readonly code = "SLOT_TAKEN";
  constructor(message = "This slot was just taken") {
    super(message);
  }
}

export class SlotUnavailableError extends Error {
  readonly code = "SLOT_UNAVAILABLE";
  constructor(message = "This time is not bookable") {
    super(message);
  }
}

export function isSlotTakenDbError(err: unknown): boolean {
  return err instanceof Error && /SLOT_TAKEN/.test(err.message);
}
