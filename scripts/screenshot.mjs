// Usage: node scripts/screenshot.mjs <url> <out.png> [width] [height] [fullPage=1]
// Uses the locally installed Chrome (no browser download).
import puppeteer from "puppeteer-core";
const [url, out, w = "1440", h = "900", full = "1"] = process.argv.slice(2);
const exe = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: 1, isMobile: Number(w) < 600, hasTouch: Number(w) < 600 });
await page.goto(url, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 600));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await page.screenshot({ path: out, fullPage: full === "1" });
console.log(`${out} overflowX=${overflow}`);
await browser.close();
