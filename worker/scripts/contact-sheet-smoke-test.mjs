import fs from "node:fs";
import path from "node:path";
import worker from "../src/index.js";

function readDevVars() {
  const text = fs.readFileSync(path.resolve(".dev.vars"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

const env = readDevVars();

async function call(action, body) {
  const request = new Request(`http://worker.test/?action=${encodeURIComponent(action)}`, {
    method: body ? "POST" : "GET",
    headers: body ? {"Content-Type": "application/json"} : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const response = await worker.fetch(request, env, {});
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(`${action} failed: ${data?.error || response.status}`);
  }
  return data;
}

async function supabase(pathname, init = {}) {
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/$/, "")}${pathname}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Profile": env.SUPABASE_SCHEMA || "public",
      "Content-Profile": env.SUPABASE_SCHEMA || "public",
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`cleanup/request failed: ${text || response.status}`);
  return text ? JSON.parse(text) : null;
}

const nonce = Date.now();
const legacyOrderId = `zz_contact_sheet_order_${nonce}`;
const orderNumber = `000CS${nonce}`;

try {
  await call("verifyContactSheetAdmin", {adminKey: env.CONTACT_SHEETS_ADMIN_KEY});
  console.log("verifyContactSheetAdmin ok");

  const prepared = await call("prepareContactSheetPublish", {
    id: legacyOrderId,
    orderNumber,
    orderNumberText: orderNumber,
    customerName: "Contact Sheet Smoke Test",
    customerEmail: "contact-sheet-smoke@saujanalab.test",
    film: "Kodak Smoke 400",
    driveLink: "https://drive.google.com/test",
    adminKey: env.CONTACT_SHEETS_ADMIN_KEY,
    requests: [
      {rollIndex: 0, variant: "delivery"},
      {rollIndex: 0, variant: "story"}
    ]
  });

  if (!prepared.uploadNonce || !Array.isArray(prepared.tickets) || prepared.tickets.length !== 2) {
    throw new Error("prepareContactSheetPublish did not return both tickets");
  }
  for (const ticket of prepared.tickets) {
    if (!ticket.uploadUrl || !ticket.fileUrl) {
      throw new Error("ticket missing uploadUrl/fileUrl");
    }
  }
  console.log("prepareContactSheetPublish tickets ok");

  const tickets = await call("createContactSheetUploadTickets", {
    orderNumber,
    uploadNonce: prepared.uploadNonce,
    requests: [
      {rollIndex: 1, variant: "delivery"},
      {rollIndex: 1, variant: "story"}
    ]
  });
  if (!Array.isArray(tickets.tickets) || tickets.tickets.length !== 2) {
    throw new Error("createContactSheetUploadTickets did not return both tickets");
  }
  console.log("createContactSheetUploadTickets ok");

  await call("cancelContactSheetUpload", {
    orderNumber,
    uploadNonce: prepared.uploadNonce
  });
  console.log("cancelContactSheetUpload ok");

  console.log("contact sheet smoke test passed");
} finally {
  await supabase(`/rest/v1/orders?legacy_order_id=eq.${encodeURIComponent(legacyOrderId)}`, {
    method: "DELETE"
  }).catch(error => console.warn("cleanup warning", error.message));
  console.log("cleanup complete");
}
