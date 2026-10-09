// Browser walk-through against a running server, with screenshots in ./screenshots.
// Usage: node scripts/e2e-demo.mjs [baseUrl]
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const BASE = process.argv[2] || "http://localhost:3100";
const exe = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
fs.mkdirSync("screenshots", { recursive: true });
const browser = await puppeteer.launch({ executablePath: exe, headless: true, protocolTimeout: 120000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("•", ...a);
async function shot(page, name, full = true) {
  await sleep(500);
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: full });
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log(`${name}.png${o > 0 ? `  (horizontal overflow ${o}px!)` : ""}`);
}
const clickText = async (page, text) => (await page.waitForSelector(`::-p-text(${text})`, { timeout: 20000 })).click();

// ---------- guest: search on desktop ----------
const desk = await browser.newPage();
await desk.setViewport({ width: 1440, height: 900 });
desk.on("pageerror", (e) => console.error("page error:", e.message));
await desk.goto(`${BASE}/`, { waitUntil: "networkidle0" });
await shot(desk, "search-desktop");

// ---------- guest: chalet page and booking on a phone ----------
const phone = await browser.newPage();
await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
phone.on("pageerror", (e) => console.error("page error:", e.message));
const start = new Date(Date.UTC(2027, 8, 6 + Math.floor(Math.random() * 80)));
const iso = (d) => d.toISOString().slice(0, 10);
const checkIn = iso(start), checkOut = iso(new Date(start.getTime() + 3 * 86400000));
log("dates", checkIn, checkOut);
await phone.goto(`${BASE}/chalets/nawras-3br-frontline?in=${checkIn}&out=${checkOut}&guests=6`, { waitUntil: "networkidle0" });
await phone.waitForFunction(() => document.querySelector(".breakdown")?.textContent?.includes("الإجمالي"), { timeout: 20000 });
await shot(phone, "listing-mobile", false);
await shot(phone, "listing-mobile-full", true);
await clickText(phone, "احجز الآن");
await phone.waitForSelector("input[name=name]", { timeout: 20000 });
await phone.type("input[name=name]", "سلمى عادل");
await phone.type("input[name=phone]", "01098765432");
await phone.type("input[name=idNumber]", "29001011234567");
await shot(phone, "checkout-mobile");
await clickText(phone, "ادفع");
await phone.waitForSelector("::-p-text(ادفع (عملية ناجحة))", { timeout: 20000 });
await shot(phone, "pay-sandbox", false);
await clickText(phone, "ادفع (عملية ناجحة)");
await phone.waitForSelector("::-p-text(الحجز مؤكد)", { timeout: 30000 });
const tripUrl = phone.url();
log("trip:", tripUrl);
await shot(phone, "trip-confirmed");
await phone.click("form button.pill.sea");
await phone.waitForSelector(".flash.ok", { timeout: 20000 });
await shot(phone, "trip-checked-in", false);

// ---------- owner ----------
await desk.close();
const own = await browser.newPage();
await own.setViewport({ width: 1440, height: 900 });
await own.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await own.type("input[name=email]", "sherif@masyaf.example");
await own.type("input[name=password]", "Masyaf#Owner2026");
await own.click("form.panel button[type=submit]");
await own.waitForSelector(".ocal", { timeout: 30000 });
await shot(own, "owner-dashboard");
const sync = await own.$("::-p-text(زامن الآن)");
await sync.click();
await own.waitForSelector(".flash", { timeout: 30000 });
log("sync:", await own.$eval(".flash", (e) => e.textContent));
for (const [p, n] of [
  ["/owner/bookings", "owner-bookings"],
  ["/owner/payouts?m=2026-07", "owner-payouts"],
  ["/owner/reviews", "owner-reviews"],
]) {
  await own.goto(`${BASE}${p}`, { waitUntil: "networkidle0" });
  await shot(own, n, false);
}

// ---------- admin ----------
const admin = await (await browser.createBrowserContext()).newPage();
await admin.setViewport({ width: 1440, height: 900 });
await admin.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await admin.type("input[name=email]", "admin@masyaf.example");
await admin.type("input[name=password]", "Masyaf#Admin2026");
await admin.click("form.panel button[type=submit]");
await admin.waitForSelector(".kpis", { timeout: 30000 });
await shot(admin, "admin", false);
await admin.goto(`${BASE}/inspector/1`, { waitUntil: "networkidle0" });
await admin.setViewport({ width: 390, height: 844, isMobile: true });
await shot(admin, "inspector-mobile", false);
await browser.close();
