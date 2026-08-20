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
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`cleanup/request failed: ${text || response.status}`);
  return text ? JSON.parse(text) : null;
}

const nonce = Date.now();
const legacyOrderId = `zz_cors_order_${nonce}`;
const orderNumber = `000CORS${nonce}`;

try {
  const prepared = await call("prepareContactSheetPublish", {
    id: legacyOrderId,
    orderNumber,
    orderNumberText: orderNumber,
    customerName: "CORS Smoke Test",
    customerEmail: "cors-smoke@saujanalab.test",
    film: "Kodak CORS 400",
    driveLink: "https://drive.google.com/test",
    adminKey: env.CONTACT_SHEETS_ADMIN_KEY,
    requests: [{rollIndex: 0, variant: "delivery"}]
  });

  const ticket = prepared.tickets?.[0];
  if (!ticket?.uploadUrl) throw new Error("No upload URL returned");
  console.log("ticket host", new URL(ticket.uploadUrl).host);

  const options = await fetch(ticket.uploadUrl, {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:4198",
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type"
    }
  });
  console.log("options status", options.status);
  console.log("allow-origin", options.headers.get("access-control-allow-origin"));
  console.log("allow-methods", options.headers.get("access-control-allow-methods"));
  console.log("allow-headers", options.headers.get("access-control-allow-headers"));
  console.log("options body", (await options.text()).slice(0, 240));
} finally {
  await supabase(`/rest/v1/orders?legacy_order_id=eq.${encodeURIComponent(legacyOrderId)}`, {
    method: "DELETE"
  }).catch(error => console.warn("cleanup warning", error.message));
  console.log("cleanup complete");
}
