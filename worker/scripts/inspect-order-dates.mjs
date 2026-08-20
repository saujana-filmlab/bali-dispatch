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

const env = readDevVars();
const base = env.SUPABASE_URL.replace(/\/$/, "");
const headers = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function get(path) {
  const response = await fetch(`${base}${path}`, {headers});
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  return JSON.parse(text || "null");
}

console.log("orders oldest");
console.log(JSON.stringify(await get("/rest/v1/orders?select=legacy_order_id,order_number,customer_name,created_at&order=created_at.asc&limit=8"), null, 2));

console.log("orders newest");
console.log(JSON.stringify(await get("/rest/v1/orders?select=legacy_order_id,order_number,customer_name,created_at&order=created_at.desc&limit=8"), null, 2));

console.log("raw sample");
console.log(JSON.stringify(await get("/rest/v1/import_orders_raw?select=*&limit=5"), null, 2));
