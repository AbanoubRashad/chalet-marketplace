import { get, getDb, onDbBoot, type DB } from "@/lib/db";
import { seedDemo } from "@/market/seed";

onDbBoot((db) => {
  if (process.env.SEED_ON_START !== "false" && !get(db, "SELECT 1 FROM platform_settings LIMIT 1")) {
    seedDemo(db);
    console.log("[seed] demo marketplace created");
  }
});

export function db(): DB {
  return getDb();
}
