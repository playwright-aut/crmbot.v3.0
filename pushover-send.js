#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

const https = require("https");
const { URLSearchParams } = require("url");

const TOKEN = process.env.PUSHOVER_TOKEN || process.env.PUSHOVER_API_TOKEN || "";
const USER = process.env.PUSHOVER_USER || process.env.PUSHOVER_USER_KEY || "";

function sendPushover({ title = "", message = "", priority = 0 }) {
  return new Promise((resolve, reject) => {
    if (!TOKEN || !USER) {
      return reject(new Error("Missing PUSHOVER_TOKEN or PUSHOVER_USER env var"));
    }

    const body = new URLSearchParams({
      token: TOKEN,
      user: USER,
      title: String(title),
      message: String(message),
      priority: String(priority)
    }).toString();

    const req = https.request(
      {
        hostname: "api.pushover.net",
        path: "/1/messages.json",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, status: res.statusCode, data });
          } else {
            reject(new Error(`Pushover HTTP ${res.statusCode}: ${data}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

if (require.main === module) {
  const [title, message] = process.argv.slice(2);
  sendPushover({ title, message })
    .then(() => {
      console.log("[pushover-send] OK");
      process.exit(0);
    })
    .catch((e) => {
      console.error("[pushover-send] FATAL:", e?.message || String(e));
      process.exit(1);
    });
}

module.exports = { sendPushover };
