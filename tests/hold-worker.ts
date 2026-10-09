import { parentPort, workerData } from "node:worker_threads";
import { openDb } from "@/lib/db";
import { createHold } from "@/market/booking";

const { file, input, now, startAt } = workerData as { file: string; input: { listingId: number; checkIn: string; checkOut: string; guests: number }; now: string; startAt: number };
const db = openDb(file);
while (Date.now() < startAt) {
  /* line up */
}
try {
  const b = createHold(db, input, new Date(now));
  parentPort!.postMessage({ ok: true, id: b.id });
} catch (err) {
  parentPort!.postMessage({ ok: false, code: (err as { code?: string }).code ?? String(err) });
}
