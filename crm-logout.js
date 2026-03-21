#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

const { chromium } = require("playwright");

const PROFILE_DIR = process.env.CRM_PROFILE_DIR || `${process.env.HOME}/crm-bot-v3/pw-profile-crm`;

(async () => {
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      viewport: { width: 1280, height: 800 }
    });

    const page = ctx.pages()[0] || await ctx.newPage();

    await ctx.clearCookies().catch(()=>{});
    await page.goto("https://sls-lds-hu02.cross.porscheinformatik.com/sales-leads/sales-lead-overview", {
      waitUntil: "domcontentloaded",
      timeout: 45000
    }).catch(()=>{});

    await page.evaluate(() => {
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
    }).catch(()=>{});

    console.log("[crm-logout] session törölve");
    process.exit(0);
  } catch (e) {
    console.error("[crm-logout] FATAL:", e?.message || String(e));
    process.exit(1);
  } finally {
    try { await ctx?.close(); } catch {}
  }
})();
