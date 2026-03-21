#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { sendPushover } = require("./pushover-send");
const { buildLeadSummary } = require("./lead-summary");

const BASE = __dirname;
const QUEUE_DIR = path.join(BASE, "VU3Queue");
const PROCESSING_DIR = path.join(BASE, "VU3QueueProcessing");
const DONE_DIR = path.join(BASE, "VU3QueueProcessed");
const BLOCKED_DIR = path.join(BASE, "VU3QueueBlocked");

const PROFILE_DIR = process.env.CRM_PROFILE_DIR || `${process.env.HOME}/crm-bot-v3/pw-profile-crm`;
const TENANT_ID = process.env.VU3_TENANT_ID || "";
const USER_UUID = process.env.VU3_USER_UUID || "";
const AFTER_ASSIGNED_DELAY_MS = Number(process.env.AFTER_ASSIGNED_DELAY_MS || 1500);

function ensureDirs() {
  for (const d of [QUEUE_DIR, PROCESSING_DIR, DONE_DIR, BLOCKED_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function listQueueFiles() {
  return fs.readdirSync(QUEUE_DIR)
    .filter(f => f.endsWith(".json"))
    .sort()
    .map(f => path.join(QUEUE_DIR, f));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function moveTo(file, dir) {
  const dst = path.join(dir, path.basename(file));
  fs.renameSync(file, dst);
  return dst;
}

function claimNextQueueFile() {
  const files = listQueueFiles();
  for (const file of files) {
    const dst = path.join(PROCESSING_DIR, path.basename(file));
    try {
      fs.renameSync(file, dst); // atomi claim ugyanazon a filesystemen
      return dst;
    } catch {
      // valaki más már elvitte
    }
  }
  return null;
}

function leadUrl(id) {
  return `https://sls-lds-hu02.cross.porscheinformatik.com/sales-leads/sales-lead/${id}?prodFam=VU3`;
}

async function safeJson(page, url, body) {
  return await page.evaluate(async ({ url, body }) => {
    const res = await fetch(url, {
      method: "PUT",
      credentials: "include",
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json;charset=UTF-8"
      },
      body: JSON.stringify(body)
    });

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, text, json };
  }, { url, body });
}

async function setStatus(page, leadId, status) {
  const url =
    `https://sls-lds-hu02.cross.porscheinformatik.com/sales-leads/internal/api/lead/sales/lead/${leadId}/status` +
    `?preventLoadingIndicator=true&crossng-tenant-id=${TENANT_ID}`;

  return await safeJson(page, url, {
    status,
    sessionUserUuid: USER_UUID
  });
}

(async () => {
  let ctx;
  let file = null;
  try {
    ensureDirs();

    file = claimNextQueueFile();
    if (!file) {
      console.log("[crm-worker] nincs queue elem.");
      process.exit(0);
    }

    console.log(`[crm-worker] feldolgozás indul: ${path.basename(file)}`);

    const payload = readJson(file);
    const leadId = String(payload?.leadId || "").trim();

    if (!leadId) {
      console.log("[crm-worker] HIBA: nincs leadId a queue fájlban.");
      const blocked = moveTo(file, BLOCKED_DIR);
      console.log(`[crm-worker] blocked -> ${blocked}`);
      process.exit(2);
    }

    console.log(`[crm-worker] leadId = ${leadId}`);
    console.log(`[crm-worker] lead oldal megnyitása: ${leadUrl(leadId)}`);

    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      viewport: { width: 1440, height: 900 }
    });

    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(leadUrl(leadId), { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(()=>{});
    await page.waitForTimeout(2000);

    const url = page.url();
    console.log(`[crm-worker] aktuális URL: ${url}`);

    if (!String(url).includes(`/sales-lead/${leadId}`)) {
      console.log("[crm-worker] HIBA: nem jutottunk a várt lead oldalra.");
      const blocked = moveTo(file, BLOCKED_DIR);
      console.log(`[crm-worker] blocked -> ${blocked}`);
      process.exit(3);
    }

    if (!TENANT_ID || !USER_UUID) {
      console.log("[crm-worker] HIBA: hiányzik VU3_TENANT_ID vagy VU3_USER_UUID a .env-ből.");
      const blocked = moveTo(file, BLOCKED_DIR);
      console.log(`[crm-worker] blocked -> ${blocked}`);
      process.exit(4);
    }

    console.log("[crm-worker] lead oldal sikeresen megnyitva.");

    console.log("[crm-worker] ASSIGNED státusz küldése...");
    const assigned = await setStatus(page, leadId, "ASSIGNED");
    console.log(`[crm-worker] ASSIGNED response: ok=${assigned.ok} status=${assigned.status}`);

    if (!assigned.ok) {
      console.log("[crm-worker] HIBA: ASSIGNED sikertelen.");
      console.log(String(assigned.text || "").slice(0, 1200));
      const blocked = moveTo(file, BLOCKED_DIR);
      console.log(`[crm-worker] blocked -> ${blocked}`);
      process.exit(5);
    }

    console.log("[crm-worker] ASSIGNED sikeres.");
    console.log(`[crm-worker] várakozás ${AFTER_ASSIGNED_DELAY_MS} ms...`);
    await sleep(AFTER_ASSIGNED_DELAY_MS);

    console.log("[crm-worker] IN_PROCESS státusz küldése...");
    const inproc = await setStatus(page, leadId, "IN_PROCESS");
    console.log(`[crm-worker] IN_PROCESS response: ok=${inproc.ok} status=${inproc.status}`);

    if (!inproc.ok) {
      console.log("[crm-worker] HIBA: IN_PROCESS sikertelen.");
      console.log(String(inproc.text || "").slice(0, 1200));
      const blocked = moveTo(file, BLOCKED_DIR);
      console.log(`[crm-worker] blocked -> ${blocked}`);
      process.exit(6);
    }

    console.log("[crm-worker] IN_PROCESS sikeres.");

    try {
      let obj = null;
      try { obj = JSON.parse((inproc && inproc.text) || (assigned && assigned.text) || ''); } catch {}
      const msg = buildLeadSummary(obj, leadId);
      if (msg) {
        await sendPushover({
          title: `Lead #${leadId} feldolgozva`,
          message: msg,
          priority: 0
        });
        console.log("[crm-worker] lead push elküldve.");
      }
    } catch (e) {
      console.log("[crm-worker] WARN: lead push nem ment ki:", e?.message || String(e));
    }

    const done = moveTo(file, DONE_DIR);
    console.log(`[crm-worker] processed -> ${done}`);
    process.exit(0);

  } catch (e) {
    console.error("[crm-worker] FATAL:", e?.message || String(e));
    try {
      if (file && fs.existsSync(file)) {
        const blocked = moveTo(file, BLOCKED_DIR);
        console.log(`[crm-worker] blocked -> ${blocked}`);
      }
    } catch {}
    try { await ctx?.close(); } catch {}
    process.exit(1);
  } finally {
    try { await ctx?.close(); } catch {}
  }
})();
