import fs from "node:fs";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const SCRIPT_NAME = process.env.CLOUDFLARE_WORKER_NAME || "bali-dispatch-api";

if (!ACCOUNT_ID) {
  throw new Error("Missing CLOUDFLARE_ACCOUNT_ID.");
}

function readTomlValue(file, key) {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
  return match ? match[1] : "";
}

async function cloudflare(path) {
  const token = readTomlValue(".wrangler-config/.wrangler/config/default.toml", "oauth_token");
  if (!token) throw new Error("Missing Cloudflare OAuth token. Run wrangler login first.");
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json();
  if (!response.ok || !body.success) {
    throw new Error(JSON.stringify({ status: response.status, errors: body.errors }));
  }
  return body.result;
}

async function updateCloudflare(path, body) {
  const token = readTomlValue(".wrangler-config/.wrangler/config/default.toml", "oauth_token");
  if (!token) throw new Error("Missing Cloudflare OAuth token. Run wrangler login first.");
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(JSON.stringify({ status: response.status, errors: result.errors }));
  }
  return result.result;
}

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: response.status, body };
}

const subdomain = await cloudflare(`/accounts/${ACCOUNT_ID}/workers/subdomain`);
const enabledSubdomain = await updateCloudflare(`/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}/subdomain`, {
  enabled: true,
  previews_enabled: true,
});
const scriptSubdomain = await cloudflare(`/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}/subdomain`);
const workerUrl = `https://${SCRIPT_NAME}.${subdomain.subdomain}.workers.dev`;

const checks = [
  ["healthcheck", `${workerUrl}/?action=dispatchHealthcheck`],
  ["customers", `${workerUrl}/?action=getCustomers`],
  ["orders", `${workerUrl}/?action=getOrders`],
  ["stock", `${workerUrl}/?action=getStock`],
  ["stockHistory", `${workerUrl}/?action=getStockHistory`],
];

console.log(`workerUrl ${workerUrl}`);
console.log(`route ${JSON.stringify({ enabledSubdomain, scriptSubdomain })}`);

for (const [label, url] of checks) {
  const result = await getJson(url);
  let summary = result.body;
  if (Array.isArray(result.body)) {
    summary = { count: result.body.length };
  } else if (result.body && typeof result.body === "object") {
    summary = {
      success: result.body.success,
      error: result.body.error,
      service: result.body.service,
      customers: Array.isArray(result.body.customers) ? result.body.customers.length : undefined,
    };
  }
  console.log(`${label} ${result.status} ${JSON.stringify(summary)}`);
}
