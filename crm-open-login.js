#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

const readline = require("readline");
const { chromium } = require("playwright");

const START_CAS = "https://sso.cross.porscheinformatik.com/cas/login?service=https%3A%2F%2Fsystemmanagement.cross.porscheinformatik.com%2Fcrossng-systemmanagement%2Flogin%2Fcas";
const FINAL_OVERVIEW = "https://sls-lds-hu02.cross.porscheinformatik.com/sales-leads/sales-lead-overview";
const PROFILE_DIR = process.env.CRM_PROFILE_DIR || `${process.env.HOME}/crm-bot-v3/pw-profile-crm`;

const USER = process.env.VU3_USER || "";
const PASS = process.env.VU3_PASS || "";

const WAIT_MS = 1800;
const NAV_MS = 60000;

function die(msg, code = 2) {
  console.log(msg);
  process.exitCode = code;
}

function urlHas(u, s) { return String(u || "").toLowerCase().includes(String(s || "").toLowerCase()); }

function isLoggedInUrl(u) {
  const x = String(u || "").toLowerCase();
  return x.includes("dashboard-hu02.cross.porscheinformatik.com") ||
         x.includes("/sales-leads/");
}

async function safeWait(page, ms = WAIT_MS) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(()=>{});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(()=>{});
  await page.waitForTimeout(ms);
}

async function clickByTextLoose(page, text) {
  const locators = [
    page.getByRole("link", { name: text, exact: false }),
    page.getByRole("button", { name: text, exact: false }),
    page.getByText(text, { exact: false }),
  ];

  for (const loc of locators) {
    const n = await loc.count().catch(()=>0);
    if (!n) continue;
    await loc.first().scrollIntoViewIfNeeded().catch(()=>{});
    await page.waitForTimeout(500);
    await loc.first().click({ timeout: 8000 }).catch(()=>{});
    await safeWait(page);
    return true;
  }
  return false;
}

async function hasPasswordPage(page) {
  const passInput = page.locator([
    'input[type="password"]',
    'input[name="password"]',
    '#password',
    'input[autocomplete="current-password"]'
  ].join(',')).first();
  return (await passInput.count().catch(()=>0)) > 0;
}

async function hasUsernamePage(page) {
  const userInput = page.locator([
    'input[autocomplete="username"]',
    'input[type="email"]',
    'input[name="username"]',
    'input[name*="user" i]',
    '#username'
  ].join(',')).first();
  return (await userInput.count().catch(()=>0)) > 0;
}

(async () => {
  let ctx;
  try {
    if (!USER || !PASS) return die("MISSING_CREDS: .env-be kell: VU3_USER és VU3_PASS", 11);

    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 }
    });

    const page = ctx.pages()[0] || await ctx.newPage();

    await page.goto(START_CAS, { waitUntil: "domcontentloaded", timeout: NAV_MS }).catch(()=>{});
    await safeWait(page);

    if (isLoggedInUrl(page.url())) {
      await page.goto(FINAL_OVERVIEW, { waitUntil:"domcontentloaded", timeout: NAV_MS }).catch(()=>{});
      await safeWait(page);
      console.log("[crm-open] OK: CRM már be volt jelentkezve, ablak nyitva marad.");
    } else {
      if (urlHas(page.url(), "/cas/login")) {
        const ok1 = await clickByTextLoose(page, "PARTNER.NET TÖBB-FAKTOROS HITELESÍTÉS");
        if (!ok1) return die('FAIL: nem találtam a "PARTNER.NET TÖBB-FAKTOROS HITELESÍTÉS" szöveget.', 20);
      }

      await safeWait(page);

      if (urlHas(page.url(), "identity.auto-partner.net/identity/authenticate") && !urlHas(page.url(), "/accounts")) {
        await page.goto("https://identity.auto-partner.net/identity/authenticate/accounts", { waitUntil:"domcontentloaded", timeout: NAV_MS }).catch(()=>{});
        await safeWait(page);
      }

      if (!isLoggedInUrl(page.url())) {
        const labels = ["PARTNER.NET FIÓK", "Partner.Net fiók", "Partner.Net FIÓK", "PARTNER.NET", "FIÓK"];
        for (const lab of labels) {
          const ok2 = await clickByTextLoose(page, lab);
          if (ok2) break;
        }

        await safeWait(page);

        if (!(await hasPasswordPage(page))) {
          if (await hasUsernamePage(page)) {
            const userInput = page.locator([
              'input[autocomplete="username"]',
              'input[type="email"]',
              'input[name="username"]',
              'input[name*="user" i]',
              '#username'
            ].join(',')).first();

            await userInput.click({ timeout: 8000 }).catch(()=>{});
            await page.waitForTimeout(500);
            await userInput.fill(USER, { timeout: 8000 }).catch(()=>{});

            const nextBtn = page.getByRole("button", { name: /tovább/i }).first();
            await page.waitForTimeout(500);
            await nextBtn.click({ timeout: 12000 }).catch(async ()=> {
              await page.keyboard.press("Enter").catch(()=>{});
            });

            await safeWait(page);
          }
        }

        if (await hasPasswordPage(page)) {
          const passInput = page.locator([
            'input[type="password"]',
            'input[name="password"]',
            '#password',
            'input[autocomplete="current-password"]'
          ].join(',')).first();

          await passInput.click({ timeout: 8000 }).catch(()=>{});
          await page.waitForTimeout(400);
          await passInput.fill(PASS, { timeout: 8000 }).catch(()=>{});

          const loginBtn = page.getByRole("button", { name: /bejelentkez|belép|login|tovább/i }).first();
          await page.waitForTimeout(400);
          await loginBtn.click({ timeout: 12000 }).catch(async ()=> {
            await page.keyboard.press("Enter").catch(()=>{});
          });

          await safeWait(page);
        }

        await page.goto(FINAL_OVERVIEW, { waitUntil:"domcontentloaded", timeout: NAV_MS }).catch(()=>{});
        await safeWait(page);

        if (urlHas(page.url(), "/sales-lead-overview")) {
          console.log("[crm-open] OK: CRM overview login kész, ablak nyitva marad.");
        } else {
          console.log("[crm-open] Figyelem: nem jutottunk biztosan az overview oldalra, ellenőrizd kézzel.");
        }
      }
    }

    console.log("[crm-open] Ha végeztél, nyomj Entert a terminálban.");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => rl.question("", () => { rl.close(); resolve(); }));

  } catch (e) {
    console.error("[crm-open] FATAL:", e?.message || String(e));
    process.exitCode = 1;
  } finally {
    try { await ctx?.close(); } catch {}
    console.log("[crm-open] Bezárva.");
  }
})();
