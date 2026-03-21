#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const BASE = __dirname;
const STATE_DIR = path.join(BASE, "state");
const STATE_FILE = path.join(STATE_DIR, "crm-session-watch.state");
const FAIL_FILE = path.join(STATE_DIR, "crm-session-watch.fail.json");
const LOCK_FILE = path.join(STATE_DIR, "crm-session-watch.autologin.lock");
const RECOVERED_FLAG = path.join(STATE_DIR, "crm-session-watch.recovered.flag");

const GRACE_MS = 30 * 1000;
const MIN_BAD_CHECKS = 2;
const RETRY_COOLDOWN_MS = 90 * 1000;

function ensureDirs() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function readState() {
  try { return fs.readFileSync(STATE_FILE, "utf8").trim(); } catch { return ""; }
}

function writeState(v) {
  fs.writeFileSync(STATE_FILE, String(v || ""), "utf8");
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

function clearFile(file) {
  try { fs.unlinkSync(file); } catch {}
}

function hasLock() {
  return fs.existsSync(LOCK_FILE);
}

function setLock() {
  fs.writeFileSync(LOCK_FILE, nowIso(), "utf8");
}

function clearLock() {
  clearFile(LOCK_FILE);
}

function run(cmd, args) {
  return spawnSync(cmd, args, { cwd: BASE, encoding: "utf8" });
}

function checkCRM() {
  const r = run(process.execPath, [path.join(BASE, "crm-login-check.js")]);
  const out = String(r.stdout || "").trim();
  return out === "ONLINE" ? "ONLINE" : "OFFLINE";
}

function runAutoLogin() {
  const r = run(process.execPath, [path.join(BASE, "crm-auto-login.js")]);
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: String(r.stdout || "").trim(),
    stderr: String(r.stderr || "").trim()
  };
}

function isWatchRunning() {
  return run("pgrep", ["-f", "run-crmwatch\\.sh"]).status === 0;
}

function isWorkerRunning() {
  return run("pgrep", ["-f", "run-crmworker\\.sh"]).status === 0;
}

function stopWatchAndWorker() {
  run("pkill", ["-f", "run-crmwatch\\.sh"]);
  run("pkill", ["-f", "run-crmworker\\.sh"]);
  run("pkill", ["-f", "node .*crm-watch\\.js"]);
  run("pkill", ["-f", "node .*crm-worker\\.js"]);
}

function startWatchAndWorker() {
  if (!isWatchRunning()) {
    run("/bin/zsh", ["-lc", `nohup /bin/zsh "${BASE}/run-crmwatch.sh" >/dev/null 2>&1 &`]);
  }
  if (!isWorkerRunning()) {
    run("/bin/zsh", ["-lc", `nohup /bin/zsh "${BASE}/run-crmworker.sh" >/dev/null 2>&1 &`]);
  }
}

(async () => {
  try {
    ensureDirs();
    console.log("[crm-session-watch] indul");

    while (true) {
      const prev = readState() || "UNKNOWN";
      const cur = checkCRM();

      if (cur === "ONLINE") {
        clearFile(FAIL_FILE);

        if (prev !== cur) {
          console.log(`[crm-session-watch] state-change ${prev} -> ${cur} @ ${nowIso()}`);
          writeState(cur);
        } else {
          console.log(`[crm-session-watch] state=${cur}`);
        }

        const recovered = readJson(RECOVERED_FLAG);

        if (recovered?.needsRestart) {
          console.log("[crm-session-watch] recovered -> watcher/worker újraindítás");
          startWatchAndWorker();
          clearFile(RECOVERED_FLAG);
        } else {
          const watchOk = isWatchRunning();
          const workerOk = isWorkerRunning();

          if (!watchOk || !workerOk) {
            console.log(`[crm-session-watch] ONLINE, de hiányzó folyamatok: watch=${watchOk} worker=${workerOk} -> újraindítás`);
            startWatchAndWorker();
          }
        }
      } else {
        const now = Date.now();
        const old = readJson(FAIL_FILE);
        const next = old
          ? {
              firstSeenMs: old.firstSeenMs || now,
              lastSeenMs: now,
              count: (old.count || 0) + 1,
              lastAutoLoginMs: old.lastAutoLoginMs || 0
            }
          : {
              firstSeenMs: now,
              lastSeenMs: now,
              count: 1,
              lastAutoLoginMs: 0
            };

        writeJson(FAIL_FILE, next);
        const ageMs = now - next.firstSeenMs;
        const sinceLastTry = next.lastAutoLoginMs ? (now - next.lastAutoLoginMs) : 999999999;

        if (prev !== "OFFLINE") {
          console.log(`[crm-session-watch] state-change ${prev} -> OFFLINE @ ${nowIso()}`);
          writeState("OFFLINE");
        }

        console.log(`[crm-session-watch] OFFLINE grace count=${next.count}/${MIN_BAD_CHECKS} ageMs=${ageMs}/${GRACE_MS} cooldownMs=${sinceLastTry}/${RETRY_COOLDOWN_MS}`);

        if (next.count >= MIN_BAD_CHECKS && ageMs >= GRACE_MS && sinceLastTry >= RETRY_COOLDOWN_MS) {
          if (!hasLock()) {
            setLock();
            try {
              console.log("[crm-session-watch] recovery: watcher/worker stop");
              stopWatchAndWorker();

              console.log("[crm-session-watch] autologin indul...");
              next.lastAutoLoginMs = Date.now();
              writeJson(FAIL_FILE, next);

              const res = runAutoLogin();
              console.log(`[crm-session-watch] autologin result ok=${res.ok} status=${res.status}`);
              if (res.stdout) console.log(`[crm-session-watch] stdout: ${res.stdout}`);
              if (res.stderr) console.log(`[crm-session-watch] stderr: ${res.stderr}`);

              const recheck = checkCRM();
              console.log(`[crm-session-watch] recheck after autologin = ${recheck}`);

              if (recheck === "ONLINE") {
                writeState("ONLINE");
                writeJson(RECOVERED_FLAG, { needsRestart: true, at: nowIso() });
                clearFile(FAIL_FILE);
              }
            } finally {
              clearLock();
            }
          } else {
            console.log("[crm-session-watch] autologin lock aktív, skip");
          }
        }
      }

      await new Promise(r => setTimeout(r, 15000));
    }
  } catch (e) {
    console.error("[crm-session-watch] FATAL:", e?.message || String(e));
    process.exit(1);
  }
})();
