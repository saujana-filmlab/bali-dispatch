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

function parseState(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) return {deliveryId: "", status: parsed.length ? "ready" : "none", sheets: parsed};
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
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

const rawRows = await request(
  "/rest/v1/import_orders_raw?select=legacy_order_id,contact_sheets_json&contact_sheets_json=not.is.null",
);

let rawWithSheets = 0;
let ordersFound = 0;
let insertedSheets = 0;
let skipped = 0;

for (const raw of rawRows) {
  const state = parseState(raw.contact_sheets_json);
  const sheets = Array.isArray(state?.sheets)
    ? state.sheets.filter(sheet => sheet && sheet.deliveryUrl && sheet.storyUrl)
    : [];
  if (!sheets.length) {
    skipped += 1;
    continue;
  }

  rawWithSheets += 1;
  const orders = await request(
    `/rest/v1/orders?select=id&legacy_order_id=eq.${encodeURIComponent(raw.legacy_order_id)}&limit=1`,
  );
  const order = orders[0];
  if (!order) {
    skipped += 1;
    continue;
  }
  ordersFound += 1;

  await request(`/rest/v1/contact_sheets?order_id=eq.${encodeURIComponent(order.id)}`, {
    method: "DELETE",
    headers: {Prefer: "return=minimal"},
  });

  await request("/rest/v1/contact_sheets", {
    method: "POST",
    headers: {Prefer: "return=minimal"},
    body: JSON.stringify(sheets.map(sheet => ({
      order_id: order.id,
      roll_index: Math.max(0, Math.round(Number(sheet.rollIndex) || 0)),
      film_name: String(sheet.filmName || sheet.rollName || "").trim() || null,
      frame_count: Math.max(0, Math.min(200, Math.round(Number(sheet.frameCount) || 0))),
      landscape_url: String(sheet.deliveryUrl || "").trim(),
      portrait_url: String(sheet.storyUrl || "").trim(),
      status: "ready",
      worker_job_id: String(state.deliveryId || "").trim() || null,
      published_at: String(state.updatedAt || "").trim() || null,
    }))),
  });

  await request(`/rest/v1/orders?id=eq.${encodeURIComponent(order.id)}`, {
    method: "PATCH",
    headers: {Prefer: "return=minimal"},
    body: JSON.stringify({contact_sheets_enabled: true}),
  });
  insertedSheets += sheets.length;
}

console.log(JSON.stringify({rawWithSheets, ordersFound, insertedSheets, skipped}, null, 2));
