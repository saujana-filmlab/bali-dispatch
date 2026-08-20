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
const workerUrl = process.env.WORKER_URL ? process.env.WORKER_URL.replace(/\/$/, "") : "";
const cleanup = [];

async function call(action, body) {
  if (workerUrl) {
    const response = await fetch(`${workerUrl}/?action=${encodeURIComponent(action)}`, {
      method: body ? "POST" : "GET",
      headers: body ? {"Content-Type": "application/json"} : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (!response.ok || data?.error) {
      throw new Error(`${action} failed: ${data?.error || response.status}`);
    }
    return data;
  }

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

async function deleteWhere(table, query) {
  await supabase(`/rest/v1/${table}?${query}`, {method: "DELETE"});
}

const nonce = Date.now();
const legacyCustomerId = `zz_test_customer_${nonce}`;
const legacyOrderId = `zz_test_order_${nonce}`;
const orderNumber = `000TEST${nonce}`;
const stockCategory = "ZZ TEST";
const stockName = `Temporary Stock ${nonce}`;
const stockHistoryId = `zz_test_stock_history_${nonce}`;

try {
  const customer = await call("addCustomer", {
    id: legacyCustomerId,
    name: "Worker Test Customer",
    email: "worker-test@saujanalab.test",
    phone: "+620000000000",
    source: "worker-smoke-test"
  });
  cleanup.push(() => deleteWhere("customers", `legacy_customer_id=eq.${encodeURIComponent(legacyCustomerId)}`));
  console.log("addCustomer", customer.id === legacyCustomerId ? "ok" : "unexpected-id");

  await call("updateCustomer", {
    id: legacyCustomerId,
    name: "Worker Test Customer Updated",
    email: "worker-test-updated@saujanalab.test",
    phone: "+620000000001"
  });
  console.log("updateCustomer ok");

  const order = await call("addOrder", {
    id: legacyOrderId,
    orderNumber,
    customerId: legacyCustomerId,
    customerName: "Worker Test Customer Updated",
    customerEmail: "worker-test-updated@saujanalab.test",
    film: "Kodak Worker 400",
    notes: "Temporary write smoke test",
    driveLink: "https://drive.google.com/test",
    extraEmails: ["second-worker-test@saujanalab.test"]
  });
  cleanup.unshift(() => deleteWhere("orders", `legacy_order_id=eq.${encodeURIComponent(legacyOrderId)}`));
  console.log("addOrder", order.orderNumber === orderNumber ? "ok" : "unexpected-order-number");

  await call("saveStock", {
    stock: [{
      category: stockCategory,
      items: [{name: stockName, qty: 3, visible: false}]
    }]
  });
  cleanup.push(() => deleteWhere(
    "stock_items",
    `category=eq.${encodeURIComponent(stockCategory)}&name=eq.${encodeURIComponent(stockName)}`
  ));
  const stock = await call("getStock");
  const testStock = stock.flatMap(group => group.items.map(item => ({...item, category: group.category})))
    .find(item => item.category === stockCategory && item.name === stockName);
  if (!testStock || testStock.qty !== 3 || testStock.visible !== false) {
    throw new Error("saveStock verification failed");
  }
  console.log("saveStock ok");

  await call("recordStockHistory", {
    id: stockHistoryId,
    action: "worker-smoke-test",
    beforeStock: [{category: stockCategory, items: []}],
    afterStock: [{category: stockCategory, items: [{name: stockName, qty: 3}]}],
    report: "Worker smoke test stock history"
  });
  cleanup.push(() => deleteWhere("stock_count_sessions", `legacy_history_id=eq.${encodeURIComponent(stockHistoryId)}`));
  const history = await call("getStockHistory");
  if (!history.some(item => item.id === stockHistoryId)) {
    throw new Error("recordStockHistory verification failed");
  }
  console.log("recordStockHistory ok");

  console.log("write smoke test passed");
} finally {
  for (const task of cleanup) {
    await task().catch(error => console.warn("cleanup warning", error.message));
  }
  console.log("cleanup complete");
}
