import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, run, type DB } from "@/lib/db";
import { seedDemo } from "@/market/seed";

delete process.env.PAYMOB_SECRET_KEY;
delete process.env.WHATSAPP_TOKEN;
process.env.PAYMOB_HMAC_SECRET = "test-hmac";

export const NOW = new Date("2026-10-09T09:00:00.000Z");
export const NAWRAS = 1;

export function freshDb(opts: { demo?: boolean } = {}): { db: DB; file: string } {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ms-test-")), "t.db");
  const db = openDb(file);
  seedDemo(db, NOW);
  if (opts.demo === false) run(db, "UPDATE platform_settings SET demo = 0");
  return { db, file };
}
