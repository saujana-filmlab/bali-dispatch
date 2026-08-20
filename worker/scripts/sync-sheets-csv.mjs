import fs from "node:fs";
import path from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const CSV_DIR = process.argv.slice(2).find(arg => !arg.startsWith("--"))
  || "C:\\Users\\User\\OneDrive\\Desktop\\Saujana DD backend\\Bali DD\\dispatch registry csv";

function readDotenv(file) {
  const values = {};
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 0) continue;
    values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  return rows
    .filter(values => values.some(value => String(value || "").trim()))
    .map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function readCsv(name) {
  return parseCsv(fs.readFileSync(path.join(CSV_DIR, name), "utf8"));
}

function clean(value) {
  return String(value ?? "").trim();
}

function nullable(value) {
  const text = clean(value);
  return text ? text : null;
}

function parseDate(value) {
  const text = clean(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseBool(value, fallback = true) {
  const text = clean(value).toLowerCase();
  if (!text) return fallback;
  return !["false", "f", "no", "n", "0"].includes(text);
}

class SupabaseClient {
  constructor(env) {
    this.baseUrl = env.SUPABASE_URL.replace(/\/$/, "");
    this.key = env.SUPABASE_SERVICE_ROLE_KEY;
    this.schema = env.SUPABASE_SCHEMA || "public";
  }

  headers(extra = {}) {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Profile": this.schema,
      "Content-Profile": this.schema,
      ...extra
    };
  }

  async request(pathname, init = {}) {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      ...init,
      headers: this.headers(init.headers)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(data?.message || data?.error || text || `Supabase HTTP ${response.status}`);
    }
    return data;
  }

  select(table, query = "") {
    return this.request(`/rest/v1/${table}${query}`);
  }

  insert(table, rows, {returning = "representation"} = {}) {
    return this.request(`/rest/v1/${table}`, {
      method: "POST",
      headers: {Prefer: `return=${returning}`},
      body: JSON.stringify(rows)
    });
  }

  update(table, query, patch) {
    return this.request(`/rest/v1/${table}${query}`, {
      method: "PATCH",
      headers: {Prefer: "return=representation"},
      body: JSON.stringify(patch)
    });
  }

  upsert(table, rows, conflictColumns, {returning = "representation"} = {}) {
    return this.request(`/rest/v1/${table}?on_conflict=${encodeURIComponent(conflictColumns)}`, {
      method: "POST",
      headers: {Prefer: `resolution=merge-duplicates,return=${returning}`},
      body: JSON.stringify(rows)
    });
  }
}

function chunk(items, size = 100) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function count(db, table) {
  const rows = await db.select(table, "?select=id");
  return rows.length;
}

async function main() {
  const env = readDotenv(path.resolve("worker/.dev.vars"));
  const db = new SupabaseClient(env);

  const customersCsv = readCsv("Customers.csv");
  const ordersCsv = readCsv("Orders.csv");
  const stockCsv = readCsv("Stock.csv");
  const historyCsv = readCsv("Stock History.csv");

  const before = {
    customers: await count(db, "customers"),
    orders: await count(db, "orders"),
    stock: await count(db, "stock_items"),
    history: await count(db, "stock_count_sessions")
  };

  const existingOrders = await db.select(
    "orders",
    "?select=id,legacy_order_id,order_number,contact_sheets_enabled&limit=10000"
  );
  const existingOrdersByLegacyId = new Map(existingOrders.map(order => [order.legacy_order_id, order]));

  const customers = customersCsv
    .filter(row => clean(row.ID) && clean(row.Name))
    .map(row => ({
      legacy_customer_id: clean(row.ID),
      name: clean(row.Name),
      email: nullable(row.Email),
      phone: nullable(row.Phone),
      source: "sheets-final-sync",
      created_at: parseDate(row["Date Added"]) || new Date(0).toISOString()
    }));

  if (!DRY_RUN) {
    for (const group of chunk(customers)) {
      await db.upsert("customers", group, "legacy_customer_id", {returning: "minimal"});
    }
  }

  const customerRows = await db.select("customers", "?select=id,legacy_customer_id&limit=10000");
  const customerIdByLegacyId = new Map(customerRows.map(customer => [customer.legacy_customer_id, customer.id]));

  const ordersToInsert = [];
  const ordersToUpdate = [];
  for (const row of ordersCsv.filter(row => clean(row.ID))) {
    const legacyOrderId = clean(row.ID);
    const hasContactSheetsJson = Boolean(clean(row["Contact Sheets JSON"]));
    const existing = existingOrdersByLegacyId.get(legacyOrderId);
    const patch = {
      legacy_order_id: legacyOrderId,
      order_number: clean(row["Order Number"]),
      legacy_customer_id: nullable(row["Customer ID"]),
      customer_id: customerIdByLegacyId.get(clean(row["Customer ID"])) || null,
      customer_name: clean(row["Customer Name"]),
      film: clean(row.Film),
      notes: nullable(row.Notes),
      drive_link: nullable(row["Drive Link"]),
      created_at: parseDate(row.Date) || new Date(0).toISOString()
    };
    if (hasContactSheetsJson || !existing) patch.contact_sheets_enabled = hasContactSheetsJson;
    if (existing) ordersToUpdate.push({id: existing.id, patch});
    else ordersToInsert.push(patch);
  }

  if (!DRY_RUN) {
    for (const group of chunk(ordersToInsert)) {
      if (group.length) await db.insert("orders", group, {returning: "minimal"});
    }
    for (const order of ordersToUpdate) {
      await db.update("orders", `?id=eq.${encodeURIComponent(order.id)}`, order.patch);
    }
  }

  const stockItems = stockCsv
    .filter(row => clean(row.Category) && clean(row.Item))
    .map(row => ({
      category: clean(row.Category).toUpperCase(),
      name: clean(row.Item),
      qty: safeInt(row.Quantity),
      visible: parseBool(row.Visible, true),
      last_updated: parseDate(row["Last Updated"]) || new Date().toISOString()
    }));

  if (!DRY_RUN) {
    const existingStock = await db.select("stock_items", "?select=id,category,name&limit=10000");
    const stockByKey = new Map(existingStock.map(item => [
      `${clean(item.category).toLowerCase()}::${clean(item.name).toLowerCase()}`,
      item
    ]));
    for (const item of stockItems) {
      const key = `${item.category.toLowerCase()}::${item.name.toLowerCase()}`;
      const existing = stockByKey.get(key);
      if (existing) await db.update("stock_items", `?id=eq.${encodeURIComponent(existing.id)}`, item);
      else await db.insert("stock_items", [item], {returning: "minimal"});
    }
  }

  const stockHistory = historyCsv
    .filter(row => clean(row.ID))
    .map(row => ({
      legacy_history_id: clean(row.ID),
      created_at: parseDate(row.Timestamp) || new Date(0).toISOString(),
      action: clean(row.Action) || "finalize",
      before_stock: nullable(row["Before Stock"]),
      after_stock: nullable(row["After Stock"]),
      report: nullable(row.Report)
    }));

  if (!DRY_RUN) {
    for (const group of chunk(stockHistory)) {
      await db.upsert("stock_count_sessions", group, "legacy_history_id", {returning: "minimal"});
    }
  }

  const after = DRY_RUN ? before : {
    customers: await count(db, "customers"),
    orders: await count(db, "orders"),
    stock: await count(db, "stock_items"),
    history: await count(db, "stock_count_sessions")
  };

  const latestOrders = ordersCsv.slice(-5).map(row => ({
    id: row.ID,
    orderNumber: row["Order Number"],
    customerName: row["Customer Name"],
    date: row.Date
  }));

  console.log(JSON.stringify({
    dryRun: DRY_RUN,
    csv: {
      customers: customersCsv.length,
      orders: ordersCsv.length,
      stock: stockCsv.length,
      history: historyCsv.length
    },
    planned: {
      customersUpsert: customers.length,
      ordersInsert: ordersToInsert.length,
      ordersUpdate: ordersToUpdate.length,
      stockUpsert: stockItems.length,
      historyUpsert: stockHistory.length
    },
    before,
    after,
    latestOrders
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
