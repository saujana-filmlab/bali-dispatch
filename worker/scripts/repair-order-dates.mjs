import fs from "node:fs";

function readDevVars() {
  const env = {};
  const text = fs.readFileSync(".dev.vars", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index < 0) continue;
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
}

function parseSheetDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  if (/^\d{12,}$/.test(text)) {
    const date = new Date(Number(text));
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

const env = readDevVars();
const base = env.SUPABASE_URL.replace(/\/$/, "");
const headers = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {...headers, ...(init.headers || {})},
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const rawOrders = await request(
  "/rest/v1/import_orders_raw?select=legacy_order_id,date_value&legacy_order_id=not.is.null&date_value=not.is.null",
);

let checked = 0;
let repaired = 0;
let skipped = 0;

for (const raw of rawOrders) {
  checked += 1;
  const legacyId = String(raw.legacy_order_id || "").trim();
  const createdAt = parseSheetDate(raw.date_value);
  if (!legacyId || !createdAt) {
    skipped += 1;
    continue;
  }

  const rows = await request(
    `/rest/v1/orders?select=id,created_at&legacy_order_id=eq.${encodeURIComponent(legacyId)}&limit=1`,
  );
  const order = rows[0];
  if (!order) {
    skipped += 1;
    continue;
  }

  if (new Date(order.created_at).getTime() === new Date(createdAt).getTime()) {
    continue;
  }

  await request(`/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`, {
    method: "PATCH",
    headers: {Prefer: "return=minimal"},
    body: JSON.stringify({created_at: createdAt}),
  });
  repaired += 1;
}

console.log(JSON.stringify({checked, repaired, skipped}, null, 2));
