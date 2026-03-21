#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

const { chromium } = require("playwright");

const PROFILE_DIR = process.env.CRM_PROFILE_DIR || `${process.env.HOME}/crm-bot-v3/pw-profile-crm`;
const OVERVIEW_URL = "https://sls-lds-hu02.cross.porscheinformatik.com/sales-leads/sales-lead-overview";

(async () => {
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: { width: 1440, height: 900 }
    });

    const page = ctx.pages()[0] || await ctx.newPage();

    await page.goto(OVERVIEW_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(()=>{});
    await page.waitForTimeout(5000);

    const url = page.url();
    const title = await page.title().catch(()=> "");
    const body = await page.locator("body").innerText().catch(()=> "");
    const tables = await page.locator("table").count().catch(()=> 0);
    const trs = await page.locator("tr").count().catch(()=> 0);
    const rows = await page.locator('[role="row"]').count().catch(()=> 0);
    const tbodys = await page.locator("table tbody").count().catch(()=> 0);

    console.log("===== URL =====");
    console.log(url);
    console.log();
    console.log("===== TITLE =====");
    console.log(title);
    console.log();
    console.log("===== COUNTS =====");
    console.log(JSON.stringify({ tables, tbodys, trs, rows }, null, 2));
    console.log();
    console.log("===== BODY EXCERPT =====");
    console.log(String(body).slice(0, 3000));
    console.log();
    console.log("===== HTML EXCERPT =====");
    const html = await page.content().catch(()=> "");
    console.log(String(html).slice(0, 5000));

    console.log();
    console.log("[crm-watch-probe] Ha végeztél, nyomj Entert a terminálban.");
    process.stdin.resume();
    process.stdin.once("data", async () => {
      try { await ctx?.close(); } catch {}
      process.exit(0);
    });
  } catch (e) {
    console.error("[crm-watch-probe] FATAL:", e?.message || String(e));
    try { await ctx?.close(); } catch {}
    process.exit(1);
  }
})();
