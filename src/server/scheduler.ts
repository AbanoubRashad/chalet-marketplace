import { runDueJobs } from "@/market/stay";
import { db } from "./db";

const g = globalThis as unknown as { __marketScheduler?: NodeJS.Timeout };

export function startScheduler(intervalMs = 60_000) {
  if (g.__marketScheduler) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runDueJobs(db());
      if (Object.values(r).some(Boolean)) console.log("[jobs]", JSON.stringify(r));
    } catch (err) {
      console.error("[jobs] failed", err);
    } finally {
      running = false;
    }
  };
  g.__marketScheduler = setInterval(tick, intervalMs);
  setTimeout(tick, 5_000);
}
