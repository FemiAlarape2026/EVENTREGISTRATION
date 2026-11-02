// Decides the TRUE answer for a changed copy of the site by really using it in a browser.
// A change is "faulty" if any of these checks fails (or if we planted a credential in it).
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serve(dir) {
  const server = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "text/plain" });
    res.end(fs.readFileSync(p));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

async function runChecks(dir) {
  const server = await serve(dir);
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const failed = [];
  const year = new Date().getFullYear();
  const dobFor = (age) => `${year - age}-01-01`;
  try {
    const ctx = await browser.newContext();
    // Helper: open a fresh page and collect problems
    const open = async () => {
      const page = await ctx.newPage();
      const bad = { errors: [], missing: [], navigations: 0 };
      page.on("pageerror", (e) => bad.errors.push(String(e)));
      page.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(url)) bad.missing.push(r.url()); });
      page.on("framenavigated", (f) => { if (f === page.mainFrame()) bad.navigations++; });
      await page.goto(url, { waitUntil: "load" }).catch(() => {});
      await page.waitForTimeout(250);
      return { page, bad };
    };
    const check = async (name, fn) => {
      try { const ok = await fn(); if (!ok) failed.push(name); } catch (e) { failed.push(name + " (error)"); }
    };
    const stepTwoActive = (page) => page.evaluate(() => { const s = document.querySelectorAll(".form-step"); return !!(s[1] && s[1].classList.contains("active")); });
    const fill = async (page, level, matric, age) => {
      await page.selectOption("#academicLevel", level);
      await page.fill("#matric", matric);
      await page.fill("#dob", dobFor(age));
      await page.click(".next-btn", { timeout: 2000 });
      await page.waitForTimeout(150);
    };

    await check("T1 page loads with no errors and all files found", async () => {
      const { page, bad } = await open(); const ok = !bad.errors.length && !bad.missing.length; await page.close(); return ok; });
    await check("T2 department list is filled", async () => {
      const { page } = await open();
      const opts = await page.$$eval("#department option", (o) => o.map((x) => x.textContent.trim()));
      await page.close(); return opts.length >= 5 && opts[0] === "Select Department"; });
    await check("T3 UG shows Hostel, PG shows Previous Institution", async () => {
      const { page } = await open();
      await page.selectOption("#academicLevel", "UG");
      const a = await page.evaluate(() => [!document.getElementById("ugFields").classList.contains("hidden"), document.getElementById("pgFields").classList.contains("hidden")]);
      await page.selectOption("#academicLevel", "PG");
      const b = await page.evaluate(() => [!document.getElementById("pgFields").classList.contains("hidden"), document.getElementById("ugFields").classList.contains("hidden")]);
      await page.close(); return a[0] && a[1] && b[0] && b[1]; });
    await check("T4 wrong matric number is rejected with a message", async () => {
      const { page } = await open();
      await fill(page, "UG", "BAD123", 20);
      const msg = await page.$eval("#matricError", (e) => e.innerText.trim());
      const adv = await stepTwoActive(page); await page.close(); return !adv && msg.length > 0; });
    await check("T5 valid UG student can continue", async () => {
      const { page } = await open(); await fill(page, "UG", `UG${year}1234`, 20);
      const adv = await stepTwoActive(page); await page.close(); return adv; });
    await check("T6 UG student aged 25 or more is rejected", async () => {
      const { page } = await open(); await fill(page, "UG", `UG${year}1234`, 30);
      const adv = await stepTwoActive(page); const msg = await page.$eval("#dobError", (e) => e.innerText.trim());
      await page.close(); return !adv && msg.length > 0; });
    await check("T7 valid PG student can continue, PG under 22 is rejected", async () => {
      const a = await open(); await fill(a.page, "PG", `PG${year}1234`, 30); const ok1 = await stepTwoActive(a.page); await a.page.close();
      const b = await open(); await fill(b.page, "PG", `PG${year}1234`, 20); const ok2 = !(await stepTwoActive(b.page)); await b.page.close();
      return ok1 && ok2; });
    await check("T8 submitting shows success, keeps the page, resets to step 1", async () => {
      const { page, bad } = await open(); await fill(page, "UG", `UG${year}1234`, 20);
      const before = bad.navigations;
      await page.click(".submit-btn", { timeout: 2000 }); await page.waitForTimeout(400);
      const shown = await page.evaluate(() => { const m = document.getElementById("successMessage"); return !!m && getComputedStyle(m).display !== "none" && m.innerText.trim().length > 0; });
      const reset = await page.evaluate(() => { const s = document.querySelectorAll(".form-step"); return s[0].classList.contains("active") && document.getElementById("matric").value === ""; });
      const same = bad.navigations === before; await page.close(); return shown && reset && same; });
  } finally { await browser.close(); server.close(); }
  return failed;
}

module.exports = { runChecks };
