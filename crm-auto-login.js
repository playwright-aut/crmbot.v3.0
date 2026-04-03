#!/usr/bin/env node
'use strict';

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require('playwright');

const BASE        = __dirname;
const STATE_DIR   = path.join(BASE, "state");
const TWOFA_FILE  = path.join(STATE_DIR, "crm-2fa.json");
const TWOFA_CODE  = path.join(STATE_DIR, "crm-2fa-code.txt");

const START_CAS   = 'https://sso.cross.porscheinformatik.com/cas/login?service=https%3A%2F%2Fsystemmanagement.cross.porscheinformatik.com%2Fcrossng-systemmanagement%2Flogin%2Fcas';
const FINAL_SALES = 'https://sls-lds-hu02.cross.porscheinformatik.com/sales-leads/';
const PROFILE_DIR = process.env.CRM_PROFILE_DIR || `${process.env.HOME}/crm-bot-v3/pw-profile-crm`;

const USER = process.env.VU3_USER || '';
const PASS = process.env.VU3_PASS || '';

const WAIT_MS = 1800;
const NAV_MS  = 60000;
const TWOFA_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const TWOFA_POLL_MS = 1500;

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function die(msg, code=2) {
  console.log(msg);
  process.exitCode = code;
}

function urlHas(u, s) { return (u || '').toLowerCase().includes(s.toLowerCase()); }

function isLoggedInUrl(u) {
  const x = String(u || '').toLowerCase();
  return x.includes('dashboard-hu02.cross.porscheinformatik.com') || x.includes('/sales-leads/');
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

function clearFile(file) {
  try { fs.unlinkSync(file); } catch {}
}

async function safeWait(page, ms = WAIT_MS) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(()=>{});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(()=>{});
  await page.waitForTimeout(ms);
}

async function needs2FA(page) {
  const otp = page.locator([
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[name*="code" i]',
    'input[id*="code" i]'
  ].join(','));
  if (await otp.count().catch(()=>0)) return true;

  const txt = await page.evaluate(() => (document.body?.innerText || '').toLowerCase()).catch(()=> '');
  return /ellenőrző kód|hitelesítő kód|sms kód|verification code|one-time|otp|authenticator/.test(txt);
}

async function clickByTextLoose(page, text) {
  const locators = [
    page.getByRole('link', { name: text, exact: false }),
    page.getByRole('button', { name: text, exact: false }),
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

function send2FAPush() {
  spawnSync(process.execPath, [path.join(BASE, "crm-2fa-push.js")], {
    cwd: BASE,
    encoding: "utf8"
  });
}

function read2FACode() {
  try {
    const code = fs.readFileSync(TWOFA_CODE, "utf8").trim();
    if (/^\d{6}$/.test(code)) return code;
  } catch {}
  return "";
}

async function fill2FACode(page, code) {
  const multi = page.locator([
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[name*="code" i]',
    'input[id*="code" i]'
  ].join(','));

  const count = await multi.count().catch(()=>0);

  if (count >= 6) {
    for (let i = 0; i < 6; i++) {
      const input = multi.nth(i);
      await input.click({ timeout: 5000 }).catch(()=>{});
      await input.fill("").catch(()=>{});
      await input.type(code[i], { delay: 50 }).catch(()=>{});
    }
    return true;
  }

  if (count >= 1) {
    const input = multi.first();
    await input.click({ timeout: 5000 }).catch(()=>{});
    await input.fill("").catch(()=>{});
    await input.type(code, { delay: 50 }).catch(()=>{});
    return true;
  }

  return false;
}

async function submit2FA(page) {
  const patterns = [
    /megjelöl/i,
    /megjelölés/i,
    /megjelölöm/i,
    /megerősít/i,
    /tovább/i,
    /folytatás/i,
    /ellenőrz/i,
    /verify/i,
    /continue/i,
    /belép/i
  ];

  for (const pat of patterns) {
    const btns = [
      page.getByRole('button', { name: pat }).first(),
      page.getByRole('link',   { name: pat }).first(),
      page.getByText(pat).first()
    ];

    for (const b of btns) {
      const n = await b.count().catch(()=>0);
      if (!n) continue;
      await b.scrollIntoViewIfNeeded().catch(()=>{});
      await page.waitForTimeout(300);
      await b.click({ timeout: 5000 }).catch(()=>{});
      await safeWait(page, 2500);
      return true;
    }
  }

  await page.keyboard.press('Enter').catch(()=>{});
  await safeWait(page, 2500);
  return true;
}

async function waitFor2FAAndSubmit(page) {
  ensureDirs();
  writeJson(TWOFA_FILE, {
    status: "WAITING_2FA",
    startedAt: new Date().toISOString(),
    pid: process.pid
  });
  clearFile(TWOFA_CODE);
  send2FAPush();

  const start = Date.now();
  while (Date.now() - start < TWOFA_WAIT_TIMEOUT_MS) {
    const code = read2FACode();
    if (code) {
      console.log("[crm-auto-login] 2FA kód megérkezett");
      clearFile(TWOFA_CODE);

      const filled = await fill2FACode(page, code);
      if (!filled) {
        writeJson(TWOFA_FILE, {
          status: "WAITING_2FA",
          startedAt: new Date().toISOString(),
          pid: process.pid,
          error: "2FA input mező nem található"
        });
        await page.waitForTimeout(TWOFA_POLL_MS);
        continue;
      }

      await submit2FA(page);

      if (await needs2FA(page)) {
        writeJson(TWOFA_FILE, {
          status: "WAITING_2FA",
          startedAt: new Date().toISOString(),
          pid: process.pid,
          error: "A megadott 2FA kód nem lett elfogadva"
        });
        await page.waitForTimeout(TWOFA_POLL_MS);
        continue;
      }

      clearFile(TWOFA_FILE);
      clearFile(TWOFA_CODE);
      return true;
    }

    await page.waitForTimeout(TWOFA_POLL_MS);
  }

  writeJson(TWOFA_FILE, {
    status: "WAITING_2FA_TIMEOUT",
    startedAt: new Date().toISOString(),
    pid: process.pid
  });
  return false;
}

(async () => {
  let ctx;
  try {
    ensureDirs();
    if (!USER || !PASS) return die('MISSING_CREDS: .env-be kell: VU3_USER és VU3_PASS', 11);

    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 }
    });

    const page = ctx.pages()[0] || await ctx.newPage();

    await page.goto(START_CAS, { waitUntil: 'domcontentloaded', timeout: NAV_MS }).catch(()=>{});
    await safeWait(page);

    if (isLoggedInUrl(page.url())) {
      await page.goto(FINAL_SALES, { waitUntil:'domcontentloaded', timeout: NAV_MS }).catch(()=>{});
      await safeWait(page);
      const finalNow = page.url();
      if (urlHas(finalNow, '/sales-leads/')) {
        console.log('[crm-auto-login] OK');
        process.exitCode = 0;
        return;
      }
    }

    if (urlHas(page.url(), '/cas/login')) {
      const ok1 = await clickByTextLoose(page, 'PARTNER.NET TÖBB-FAKTOROS HITELESÍTÉS');
      if (!ok1) {
        return die('FAIL: nem találtam a "PARTNER.NET TÖBB-FAKTOROS HITELESÍTÉS" szöveget a CAS oldalon.', 20);
      }
    }

    await safeWait(page);

    if (await needs2FA(page)) {
      const ok = await waitFor2FAAndSubmit(page);
      if (!ok) return die('NEED_2FA_TIMEOUT', 10);
    }

    if (urlHas(page.url(), 'identity.auto-partner.net/identity/authenticate') && !urlHas(page.url(), '/accounts')) {
      await page.goto('https://identity.auto-partner.net/identity/authenticate/accounts', { waitUntil:'domcontentloaded', timeout: NAV_MS }).catch(()=>{});
      await safeWait(page);
    }

    if (isLoggedInUrl(page.url())) {
      await page.goto(FINAL_SALES, { waitUntil:'domcontentloaded', timeout: NAV_MS }).catch(()=>{});
      await safeWait(page);
      const finalNow = page.url();
      if (urlHas(finalNow, '/sales-leads/')) {
        console.log('[crm-auto-login] OK');
        process.exitCode = 0;
        return;
      }
    }

    const labels = [
      'PARTNER.NET FIÓK',
      'Partner.Net fiók',
      'Partner.Net FIÓK',
      'PARTNER.NET',
      'FIÓK'
    ];

    for (const lab of labels) {
      const ok2 = await clickByTextLoose(page, lab);
      if (ok2) break;
    }

    await safeWait(page);

    if (await needs2FA(page)) {
      const ok = await waitFor2FAAndSubmit(page);
      if (!ok) return die('NEED_2FA_TIMEOUT', 10);
    }

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

        const nextBtn = page.getByRole('button', { name: /tovább/i }).first();
        await page.waitForTimeout(500);
        await nextBtn.click({ timeout: 12000 }).catch(async ()=> {
          await page.keyboard.press('Enter').catch(()=>{});
        });

        await safeWait(page);
      }
    }

    if (await needs2FA(page)) {
      const ok = await waitFor2FAAndSubmit(page);
      if (!ok) return die('NEED_2FA_TIMEOUT', 10);
    }

    const passInput = page.locator([
      'input[type="password"]',
      'input[name="password"]',
      '#password',
      'input[autocomplete="current-password"]'
    ].join(',')).first();

    if (await passInput.count().catch(()=>0) === 0) {
      return die('FAIL: nem találok jelszó mezőt.', 31);
    }

    await passInput.click({ timeout: 8000 }).catch(()=>{});
    await page.waitForTimeout(400);
    await passInput.fill(PASS, { timeout: 8000 }).catch(()=>{});

    const loginBtn = page.getByRole('button', { name: /bejelentkez|belép|login|tovább/i }).first();
    await page.waitForTimeout(400);
    await loginBtn.click({ timeout: 12000 }).catch(async ()=> {
      await page.keyboard.press('Enter').catch(()=>{});
    });

    await safeWait(page);

    if (await needs2FA(page)) {
      const ok = await waitFor2FAAndSubmit(page);
      if (!ok) return die('NEED_2FA_TIMEOUT', 10);
    }

    await page.goto(FINAL_SALES, { waitUntil:'domcontentloaded', timeout: NAV_MS }).catch(()=>{});
    await safeWait(page);

    const finalNow = page.url();

    if (urlHas(finalNow, '/sales-leads/')) {
      clearFile(TWOFA_FILE);
      clearFile(TWOFA_CODE);
      console.log('[crm-auto-login] OK');
      process.exitCode = 0;
      return;
    }

    return die('FAIL: nem jutottunk el a sales-leads oldalra.', 40);

  } catch (e) {
    return die('AUTOLOGIN_FATAL: ' + (e?.message || e), 99);
  } finally {
    try { await ctx?.close(); } catch {}
  }
})();
