// npm run seed            -> create the demo marketplace if missing (idempotent)
// npm run seed -- --reset -> wipe and recreate it
import path from "node:path";
import { openDb } from "@/lib/db";
import { DEMO_LOGINS, resetDemo, seedDemo } from "@/market/seed";

const db = openDb(process.env.DATABASE_PATH || path.join(process.cwd(), "data", "market.db"));
if (process.argv.includes("--reset")) resetDemo(db);
seedDemo(db);
console.log("Demo marketplace ready.");
for (const u of DEMO_LOGINS) console.log(`  ${u.role.padEnd(10)} ${u.email}  ${u.password}`);
