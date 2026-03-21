#!/usr/bin/env node
'use strict';

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });
const { chromium } = require('playwright');

const START_CAS   = 'https://sso.cross.porscheinformatik.com/cas/login?service=https%3A%2F%2Fsystemmanagement.cross.porscheinformatik.com%2Fcrossng-systemmanagement%2Flogin%2Fcas';
const FINAL_SALES = 'https://sls-lds-hu02.cross.porscheinformatik.com/sales-leads/';
const PROFILE_DIR = process.env.CRM_PROFILE_DIR || `${process.env.HOME}/crm-bot-v3/pw-profile-crm`;

const USER = process.env.VU3_USER || '';
const PASS = process.env.VU3_PASS || '';

const WAIT_MS = 1800;
const NAV_MS  = 60000;

function die(msg, code=2) {
  console.log(msg);
  process.exitCode = code;
}

function urlHas(u, s) { return (u || '').toLowerCase().includes(s.toLowerCase()); }

function isLoggedInUrl(u) {
  const x = String(u || '').toLowerCase();
  return (
    x.includes('dashboard-hu02.cross.porscheinformatik.com') ||
    x.includes('/sales-leads/')
  );
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

(async () => {
  let ctx;
  try {
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

    if (await needs2FA(page)) return die('NEED_2FA', 10);

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

    let ok2 = false;
    for (const lab of labels) {
      ok2 = await clickByTextLoose(page, lab);
      if (ok2) break;
    }

    await safeWait(page);

    if (await needs2FA(page)) return die('NEED_2FA', 10);

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

    if (await needs2FA(page)) return die('NEED_2FA', 10);

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

    if (await needs2FA(page)) return die('NEED_2FA', 10);

    await page.goto(FINAL_SALES, { waitUntil:'domcontentloaded', timeout: NAV_MS }).catch(()=>{});
    await safeWait(page);

    const finalNow = page.url();

    if (urlHas(finalNow, '/sales-leads/')) {
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
