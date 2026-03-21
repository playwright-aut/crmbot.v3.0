#!/usr/bin/env node
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, ".env"), quiet: true });

const { sendPushover } = require("./pushover-send");

const state = String(process.argv[2] || "").trim().toUpperCase();

if (!state || !["ONLINE", "OFFLINE"].includes(state)) {
  console.error("[crm-state-push] add meg: ONLINE vagy OFFLINE");
  process.exit(2);
}

const title = "VU3CRM";
const message = state === "ONLINE"
  ? "✅ A bot ONLINE állapotban van. Minden folyamat aktív."
  : "🛑 A bot OFFLINE. Minden folyamat megállt.";

sendPushover({ title, message })
  .then(() => {
    console.log(`[crm-state-push] ${state} push elküldve`);
    process.exit(0);
  })
  .catch((e) => {
    console.error("[crm-state-push] FATAL:", e?.message || String(e));
    process.exit(1);
  });
