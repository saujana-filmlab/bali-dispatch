import fs from "node:fs";
import path from "node:path";
import worker from "../src/index.js";

function readDevVars() {
  const file = path.resolve(".dev.vars");
  const text = fs.readFileSync(file, "utf8");
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

async function call(action, body) {
  const request = new Request(`http://worker.test/?action=${encodeURIComponent(action)}`, {
    method: body ? "POST" : "GET",
    headers: body ? {"Content-Type": "application/json"} : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const response = await worker.fetch(request, readDevVars(), {});
  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(`${action} failed: ${data?.error || response.status}`);
  }
  return data;
}

const health = await call("dispatchHealthcheck");
console.log("healthcheck", health.ok === true ? "ok" : health);

const customers = await call("getCustomers");
console.log("customers", Array.isArray(customers) ? customers.length : "not-array");

const initialData = await call("getInitialData");
console.log(
  "initialData",
  Array.isArray(initialData.customers) && Array.isArray(initialData.orders)
    ? `${initialData.customers.length}/${initialData.orders.length}`
    : "bad-shape"
);

const orders = await call("getOrders");
console.log("orders", Array.isArray(orders) ? orders.length : "not-array");
console.log("leadingZeroOrders", orders.filter(order => String(order.orderNumber).startsWith("0")).slice(0, 5).map(order => order.orderNumber).join(", "));

const sampleOrder = orders.find(order => String(order.orderNumber || "").trim());
if (sampleOrder) {
  const order = await call("getOrderByNumber", {orderNumber: sampleOrder.orderNumber});
  console.log("getOrderByNumber", order?.orderNumber === sampleOrder.orderNumber ? "ok" : "not-found");
}

const stock = await call("getStock");
console.log("stockCategories", Array.isArray(stock) ? stock.length : "not-array");
console.log("stockItems", Array.isArray(stock) ? stock.reduce((total, group) => total + (group.items?.length || 0), 0) : "not-array");

const history = await call("getStockHistory");
console.log("stockSessions", Array.isArray(history) ? history.length : "not-array");
