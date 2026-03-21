function clean(s) {
  return String(s || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pick(obj, paths) {
  for (const p of paths) {
    try {
      const v = p.split(".").reduce((a, k) => (a && a[k] !== undefined) ? a[k] : undefined, obj);
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    } catch {}
  }
  return "";
}

function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = String(text || "").match(re);
    if (m && m[1]) return clean(m[1]);
  }
  return "";
}

function extractCustomerNote(text) {
  const t = String(text || "");
  const m = t.match(/-?Ügyféladatok:\s*([\s\S]*?)\s*Ügyfél üzenete:/i);
  if (!m) return "";
  return clean(m[1]);
}

function stripModelSuffix(model) {
  return clean(String(model || "").replace(/\s*\([^)]*\)\s*$/, ""));
}

function extractFullModel(text) {
  const raw = firstMatch(text, [
    /Modell:\s*(.+?)(?:\n|$)/i
  ]);
  return stripModelSuffix(raw);
}

function extractCommission(text) {
  return firstMatch(text, [
    /Kommissziós szám:\s*(0\d{6})(?:\D|$)/i
  ]);
}

function extractAdditionalNotes(text) {
  return firstMatch(text, [
    /További\s+megjegyzések:\s*(.+?)(?:\n(?:[A-ZÁÉÍÓÖŐÚÜŰ][^:\n]{0,80}:)|\n\s*\n|$)/is
  ]);
}

function hasTestDriveInterest(text) {
  const t = String(text || "");
  return /Érdekel\s+tesztvezetési\s+lehetőség\.?/i.test(t) || /tesztvezet/i.test(t);
}

function buildLeadSummary(obj, leadId) {
  if (!obj || typeof obj !== "object") return `Lead #${leadId} feldolgozva (nincs részlet)`;

  const first = pick(obj, [
    "salesLeadContactPDTO.contactPersonPDTO.firstName",
    "salesLeadContactPDTO.contactPersonPDTO.firstname",
  ]);
  const last = pick(obj, [
    "salesLeadContactPDTO.contactPersonPDTO.lastName",
    "salesLeadContactPDTO.contactPersonPDTO.lastname",
  ]);
  const name = clean([first, last].filter(Boolean).join(" "));

  const company = clean(pick(obj, [
    "salesLeadContactPDTO.contactPersonPDTO.company",
    "salesLeadContactPDTO.contactPersonPDTO.companyName",
  ]));

  const street = clean(pick(obj, ["salesLeadContactPDTO.contactAddressPDTO.street"]));
  const city = clean(pick(obj, ["salesLeadContactPDTO.contactAddressPDTO.city"]));
  const postal = clean(pick(obj, ["salesLeadContactPDTO.contactAddressPDTO.postalCode"]));
  const address = clean([street, [postal, city].filter(Boolean).join(" ")].filter(Boolean).join(", "));

  const channels = Array.isArray(obj?.salesLeadContactPDTO?.contactChannelPDTOList)
    ? obj.salesLeadContactPDTO.contactChannelPDTOList
    : [];

  const email = clean(
    (channels.find(c => c?.type === "EMAIL" && c?.primary)?.contact) ||
    (channels.find(c => c?.type === "EMAIL")?.contact) ||
    ""
  );

  const phone = clean(
    (channels.find(c => c?.type === "TELEPHONE" && c?.primary)?.contact) ||
    (channels.find(c => c?.type === "TELEPHONE")?.contact) ||
    ""
  );

  const remarks = String(obj?.salesLeadInterestPDTO?.remarks || "");

  const fullModelFromRemarks = extractFullModel(remarks);
  const fallbackModel = stripModelSuffix(clean(pick(obj, [
    "vehiclePDTO.modelDesignation",
    "vehiclePDTO.model",
    "vehiclePDTO.modelName"
  ])));
  const model = fullModelFromRemarks || fallbackModel;

  const commission = extractCommission(remarks);
  const customerNote = extractCustomerNote(remarks);
  const additionalNotes = extractAdditionalNotes(remarks);
  const wantsTestDrive = hasTestDriveInterest(remarks);

  const lines = [];
  lines.push("Ügyféladatok:");
  lines.push("");

  if (name) lines.push(`Név: ${name}`);
  if (company) lines.push(`Cég: ${company}`);
  if (address) lines.push(`Cím: ${address}`);
  if (email) lines.push(`E-mail: ${email}`);
  if (phone) lines.push(`Telefonszám: ${phone}`);

  if (customerNote) {
    lines.push("Ügyfél megjegyzés:");
    lines.push(customerNote);
  }

  if (additionalNotes) {
    lines.push("További megjegyzések:");
    lines.push(additionalNotes);
  }

  if (model) {
    lines.push("");
    lines.push("Modell:");
    lines.push(model);
  }

  if (commission) {
    lines.push("");
    lines.push(`Kommissziós szám: ${commission}`);
  }

  if (wantsTestDrive) {
    lines.push("");
    lines.push("Érdekel tesztvezetési lehetőség.");
  }

  const msg = lines.join("\n").trim();
  return msg || `Lead #${leadId} feldolgozva (nincs részlet)`;
}

module.exports = { buildLeadSummary };
