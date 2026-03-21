#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

const { chromium } = require("playwright");

const PROFILE_DIR = process.env.CRM_PROFILE_DIR || `${process.env.HOME}/crm-bot-v3/pw-profile-crm`;
const OVERVIEW_URL = "https://sls-lds-hu02.cross.porscheinformatik.com/sales-leads/sales-lead-overview";

function isOverviewUrl(u) {
  return String(u || "").toLowerCase().includes("/sales-lead-overview");
}

(async () => {
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      viewport: { width: 1280, height: 800 }
    });

    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(OVERVIEW_URL, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(()=>{});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(()=>{});
    await page.waitForTimeout(1500);

    const url = page.url();
    if (isOverviewUrl(url)) {
      console.log("ONLINE");
    } else {
      console.log("OFFLINE");
    }
  } catch {
    console.log("OFFLINE");
  } finally {
    try { await ctx?.close(); } catch {}
  }
})();
