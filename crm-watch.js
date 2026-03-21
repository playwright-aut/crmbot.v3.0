#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const BASE = __dirname;
const PROFILE_DIR = process.env.CRM_PROFILE_DIR || `${process.env.HOME}/crm-bot-v3/pw-profile-crm`;
const OVERVIEW_URL = "https://sls-lds-hu02.cross.porscheinformatik.com/sales-leads/sales-lead-overview";

const DEBUG_DIR = path.join(BASE, "debug");
const STATE_DIR = path.join(BASE, "state");
const QUEUE_DIR = path.join(BASE, "VU3Queue");
const STATE_FILE = path.join(STATE_DIR, "crm-watch.top.json");
const LAST_ENQUEUED_FILE = path.join(STATE_DIR, "crm-watch.last-enqueued.json");

function ensureDirs() {
  for (const d of [DEBUG_DIR, STATE_DIR, QUEUE_DIR]) fs.mkdirSync(d, { recursive: true });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

async function textOf(locator) {
  try {
    return (await locator.innerText()).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

async function findTopLeadRow(page) {
  const rows = page.locator('[role="row"]');
  const count = await rows.count().catch(() => 0);

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const txt = await textOf(row);

    if (!txt) continue;
    if (!/\b\d{4,7}\b/.test(txt)) continue;
    if (!/Debrecen Autóház|Kapcsolatfelvételi|Folyamatban|Elvesztett/i.test(txt)) continue;

    return row;
  }
  return null;
}

async function getTopLead(page) {
  const row = await findTopLeadRow(page);
  if (!row) return null;

  const txt = await textOf(row);
  const m = txt.match(/\b(\d{4,7})\b/);
  const leadId = m ? m[1] : "";

  if (!leadId) return null;

  return {
    leadId,
    text: txt.slice(0, 400)
  };
}

function queueLead(top) {
  const ts = Date.now();
  const out = {
    leadId: top.leadId,
    source: "overview",
    detectedAt: new Date().toISOString(),
    top
  };

  const file = path.join(QUEUE_DIR, `lead-${top.leadId}-overview-${ts}.json`);
  writeJson(file, out);
  return file;
}

function recentlyEnqueuedSameLead(leadId) {
  const last = readJson(LAST_ENQUEUED_FILE);
  if (!last || !last.leadId || !last.at) return false;
  if (String(last.leadId) !== String(leadId)) return false;

  const ageMs = Date.now() - Number(last.at);
  return ageMs < 10 * 60 * 1000; // 10 perc védelem ugyanarra a leadre
}

function markEnqueued(leadId) {
  writeJson(LAST_ENQUEUED_FILE, {
    leadId: String(leadId),
    at: Date.now()
  });
}

(async () => {
  let ctx;
  try {
    ensureDirs();

    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      viewport: { width: 1440, height: 900 }
    });

    const page = ctx.pages()[0] || await ctx.newPage();

    console.log("[crm-watch] overview megnyitása...");
    await page.goto(OVERVIEW_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(()=>{});
    await page.waitForTimeout(3000);

    const first = await getTopLead(page);
    if (!first) {
      console.log("[crm-watch] Nem találtam valódi lead sort az overview oldalon.");
      process.exit(2);
    }

    const prev = readJson(STATE_FILE);
    if (!prev) {
      writeJson(STATE_FILE, first);
      console.log(`[crm-watch] kezdeti top lead eltárolva: ${first.leadId}`);
    } else {
      console.log(`[crm-watch] előző top lead: ${prev.leadId || "?"}`);
      console.log(`[crm-watch] aktuális top lead: ${first.leadId || "?"}`);

      if (String(prev.leadId) !== String(first.leadId)) {
        if (!recentlyEnqueuedSameLead(first.leadId)) {
          const qf = queueLead(first);
          markEnqueued(first.leadId);
          console.log(`[crm-watch] ÚJ TOP LEAD ${first.leadId} -> queue írva: ${qf}`);
        } else {
          console.log(`[crm-watch] DUPLA VÉDELEM: ${first.leadId} nem kerül újra queue-ba`);
        }
        writeJson(STATE_FILE, first);
      } else {
        console.log(`[crm-watch] nincs változás (${first.leadId})`);
      }
    }

    console.log("[crm-watch] loop indul (10 mp)...");
    while (true) {
      await sleep(10000);

      await page.goto(OVERVIEW_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(()=>{});
      await page.waitForTimeout(2000);

      const cur = await getTopLead(page);
      if (!cur) {
        console.log("[crm-watch] WARN: nincs olvasható top sor.");
        continue;
      }

      const last = readJson(STATE_FILE);

      if (!last || String(last.leadId) !== String(cur.leadId)) {
        if (!recentlyEnqueuedSameLead(cur.leadId)) {
          const qf = queueLead(cur);
          markEnqueued(cur.leadId);
          console.log(`[crm-watch] ÚJ TOP LEAD ${cur.leadId} -> queue írva: ${qf}`);
        } else {
          console.log(`[crm-watch] DUPLA VÉDELEM: ${cur.leadId} nem kerül újra queue-ba`);
        }
        writeJson(STATE_FILE, cur);
      } else {
        console.log(`[crm-watch] nincs változás (${cur.leadId})`);
      }
    }

  } catch (e) {
    const msg = e?.message || String(e);

    if (/Target page, context or browser has been closed/i.test(msg)) {
      console.log("[crm-watch] WARN: browser/context bezáródott, wrapper újraindítja.");
      try { await ctx?.close(); } catch {}
      process.exit(0);
    }

    console.error("[crm-watch] FATAL:", msg);
    try { await ctx?.close(); } catch {}
    process.exit(1);
  }
})();
