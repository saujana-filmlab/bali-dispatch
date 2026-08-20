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

async function binaryCall(params, bytes) {
  const request = new Request(`http://worker.test/?${new URLSearchParams(params).toString()}`, {
    method: "POST",
    headers: {"Content-Type": "image/jpeg"},
    body: bytes
  });
  const response = await worker.fetch(request, env, {});
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(`${params.action} failed: ${data?.error || response.status} ${data?.detail || ""}`.trim());
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
const legacyOrderId = `zz_proxy_upload_order_${nonce}`;
const orderNumber = `000PROXY${nonce}`;

try {
  const prepared = await call("prepareContactSheetPublish", {
    id: legacyOrderId,
    orderNumber,
    orderNumberText: orderNumber,
    customerName: "Proxy Upload Smoke Test",
    customerEmail: "proxy-upload@saujanalab.test",
    film: "Kodak Proxy 400",
    driveLink: "https://drive.google.com/test",
    adminKey: env.CONTACT_SHEETS_ADMIN_KEY,
    requests: []
  });

  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
    0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
    0x00, 0x48, 0x00, 0x00, 0xff, 0xd9
  ]);

  const uploaded = await binaryCall({
    action: "uploadContactSheetFile",
    orderNumber,
    uploadNonce: prepared.uploadNonce,
    rollIndex: "0",
    variant: "delivery"
  }, jpeg);
  if (!uploaded.fileUrl) throw new Error("Proxy upload did not return fileUrl");
  console.log("proxy upload ok", uploaded.fileUrl);

  await call("cancelContactSheetUpload", {
    orderNumber,
    uploadNonce: prepared.uploadNonce
  });
  console.log("cancel ok");
} finally {
  await supabase(`/rest/v1/orders?legacy_order_id=eq.${encodeURIComponent(legacyOrderId)}`, {
    method: "DELETE"
  }).catch(error => console.warn("cleanup warning", error.message));
  console.log("cleanup complete");
}
