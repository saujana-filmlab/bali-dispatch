const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400"
};

const JSON_HEADERS = {
  ...CORS_HEADERS,
  "Content-Type": "application/json; charset=utf-8"
};
const CONTACT_SHEETS_MAX_ROLLS = 20;
const CONTACT_SHEETS_ALLOWED_STYLES = new Set(["classic", "isle-punch", "flat"]);
const CONTACT_SHEETS_ALLOWED_FORMATS = new Set(["full-frame", "half-frame"]);

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {...JSON_HEADERS, ...(init.headers || {})}
  });
}

function cleanText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseBoolean(value, fallback = true) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return !["false", "f", "no", "n", "0"].includes(String(value).trim().toLowerCase());
}

function safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ""));
}

async function sha256(value) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", textBytes(value))));
}

async function hmacSha256(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    textBytes(secret),
    {name: "HMAC", hash: "SHA-256"},
    false,
    ["sign"]
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, textBytes(value))));
}

function safeStringEqual(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function requireContactSheetSettings(env) {
  const url = cleanText(env.CONTACT_SHEETS_WORKER_URL).replace(/\/$/, "");
  const secret = String(env.CONTACT_SHEETS_WORKER_SECRET || "");
  if (!url || !/^https:\/\//i.test(url)) throw new Error("CONTACT_SHEETS_WORKER_URL is missing or invalid");
  if (!secret) throw new Error("CONTACT_SHEETS_WORKER_SECRET is missing");
  return {url, secret};
}

function eqFilter(column, value) {
  return `${column}.eq.${encodeURIComponent(value)}`;
}

async function readPayload(request) {
  if (request.method !== "POST") return {};
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error("Request body must be valid JSON");
  }
}

function payloadFromQuery(url) {
  return Object.fromEntries(url.searchParams.entries());
}

class SupabaseClient {
  constructor(env) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase environment variables are not configured");
    }
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

  async request(path, init = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: this.headers(init.headers)
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = text;
      }
    }
    if (!response.ok) {
      const message = data?.message || data?.error_description || data?.error || text || `Supabase HTTP ${response.status}`;
      throw new Error(message);
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

  update(table, query, patch, {single = false} = {}) {
    return this.request(`/rest/v1/${table}${query}`, {
      method: "PATCH",
      headers: {Prefer: `return=representation${single ? "" : ""}`},
      body: JSON.stringify(patch)
    });
  }

  delete(table, query) {
    return this.request(`/rest/v1/${table}${query}`, {
      method: "DELETE",
      headers: {Prefer: "return=representation"}
    });
  }

  upsert(table, rows, conflictColumns) {
    const query = conflictColumns ? `?on_conflict=${encodeURIComponent(conflictColumns)}` : "";
    return this.request(`/rest/v1/${table}${query}`, {
      method: "POST",
      headers: {Prefer: "resolution=merge-duplicates,return=representation"},
      body: JSON.stringify(rows)
    });
  }

  rpc(name, args = {}) {
    return this.request(`/rest/v1/rpc/${name}`, {
      method: "POST",
      body: JSON.stringify(args)
    });
  }
}

function customerFromRow(row) {
  return {
    id: row.legacy_customer_id || row.id,
    supabaseId: row.id,
    name: row.name || "",
    email: row.email || "",
    phone: row.phone || "",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    totalOrders: Number(row.total_orders || 0),
    lastOrderDate: row.last_order_date ? new Date(row.last_order_date).getTime() : null
  };
}

function orderFromRow(row) {
  return {
    id: row.legacy_order_id || row.id,
    supabaseId: row.id,
    orderNumber: String(row.order_number || ""),
    customerId: row.legacy_customer_id || "",
    customerName: row.customer_name || "",
    customerEmail: row.customer_email || "",
    customerPhone: row.customer_phone || "",
    deliveryName: row.delivery_display_name || "",
    film: row.film || "",
    notes: row.notes || "",
    driveLink: row.drive_link || "",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now()
  };
}

function contactSheetFromRow(row) {
  return {
    rollIndex: Number(row.roll_index) || 0,
    filmName: row.film_name || "",
    frameCount: Number(row.frame_count) || 0,
    scanStyle: row.scan_style || "classic",
    format: row.format || "full-frame",
    deliveryUrl: row.landscape_url || "",
    storyUrl: row.portrait_url || ""
  };
}

function csvValue(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvFile(headers, rows) {
  const body = [
    headers.map(csvValue).join(","),
    ...rows.map(row => headers.map(header => csvValue(row[header])).join(","))
  ].join("\n");
  return `\uFEFF${body}`;
}

async function getCustomers(db) {
  const rows = await db.select(
    "customers",
    "?select=id,legacy_customer_id,name,email,phone,created_at,orders(created_at)&order=created_at.desc"
  );
  return rows.map(row => {
    const orders = Array.isArray(row.orders) ? row.orders : [];
    const lastOrderDate = orders.length
      ? Math.max(...orders.map(order => order.created_at ? new Date(order.created_at).getTime() : 0))
      : null;
    return customerFromRow({
      ...row,
      total_orders: orders.length,
      last_order_date: lastOrderDate ? new Date(lastOrderDate).toISOString() : null
    });
  });
}

async function addCustomer(db, data) {
  const name = cleanText(data.name);
  if (!name) return {error: "Missing customer name"};

  const legacyId = cleanText(data.id) || `c_${Date.now()}`;
  const rows = await db.insert("customers", [{
    legacy_customer_id: legacyId,
    name,
    email: cleanText(data.email) || null,
    phone: cleanText(data.phone) || null,
    source: cleanText(data.source) || "dispatch-worker"
  }]);
  return customerFromRow(rows[0]);
}

async function updateCustomer(db, data) {
  const id = cleanText(data.id || data.customerId);
  if (!id) return {error: "Missing customer id"};
  const patch = {
    name: cleanText(data.name),
    email: cleanText(data.email) || null,
    phone: cleanText(data.phone) || null
  };
  if (!patch.name) return {error: "Missing customer name"};

  const filters = [eqFilter("legacy_customer_id", id)];
  if (isUuid(id)) filters.push(eqFilter("id", id));
  const rows = await db.update(
    "customers",
    `?or=(${filters.join(",")})`,
    patch
  );
  if (!rows.length) return {error: "Customer not found"};
  return {success: true};
}

async function deleteCustomer(db, data) {
  const id = cleanText(typeof data === "string" ? data : data.id || data.customerId);
  if (!id) return {error: "Missing customer id"};

  const filters = [eqFilter("legacy_customer_id", id)];
  if (isUuid(id)) filters.push(eqFilter("id", id));
  const customers = await db.select(
    "customers",
    `?select=id,legacy_customer_id&or=(${filters.join(",")})&limit=1`
  );
  const customer = customers[0];
  if (!customer) return {error: "Customer not found", id};

  await db.update(
    "orders",
    `?customer_id=eq.${encodeURIComponent(customer.id)}`,
    {customer_id: null}
  );
  await db.delete("customers", `?id=eq.${encodeURIComponent(customer.id)}`);
  return {success: true, deletedId: id};
}

async function getOrders(db) {
  const rows = await db.select(
    "orders",
    "?select=id,legacy_order_id,order_number,legacy_customer_id,customer_name,customer_email,customer_phone,delivery_display_name,film,notes,drive_link,created_at&order=created_at.desc"
  );
  return rows.map(orderFromRow);
}

async function getInitialData(db) {
  const [customers, orders] = await Promise.all([
    getCustomers(db),
    getOrders(db)
  ]);
  return {customers, orders};
}

async function getOrderByNumber(db, data) {
  const orderNumber = cleanText(data.orderNumber || data.order || data);
  if (!orderNumber) return {error: "Missing order number"};

  const rows = await db.select(
    "orders",
    `?select=id,legacy_order_id,order_number,legacy_customer_id,customer_name,customer_email,customer_phone,delivery_display_name,film,notes,drive_link,created_at,contact_sheets(id,roll_index,film_name,frame_count,landscape_url,portrait_url,status)&order_number=eq.${encodeURIComponent(orderNumber)}&limit=1`
  );
  const row = rows[0];
  if (!row) return null;
  const sheets = Array.isArray(row.contact_sheets)
    ? row.contact_sheets
        .filter(sheet => sheet.status === "ready" && (sheet.landscape_url || sheet.portrait_url))
        .sort((a, b) => (Number(a.roll_index) || 0) - (Number(b.roll_index) || 0))
        .map(contactSheetFromRow)
    : [];
  const hasPending = Array.isArray(row.contact_sheets)
    && row.contact_sheets.some(sheet => sheet.status && sheet.status !== "ready");
  return {
    ...orderFromRow(row),
    contactSheets: sheets,
    contactSheetStatus: sheets.length ? "ready" : (hasPending ? "uploading" : "none")
  };
}

async function getOrderRowByNumber(db, orderNumber) {
  const rows = await db.select(
    "orders",
    `?select=id,legacy_order_id,order_number,legacy_customer_id,customer_name,customer_email,customer_phone,delivery_display_name,film,notes,drive_link,created_at&order_number=eq.${encodeURIComponent(orderNumber)}&order=created_at.desc&limit=1`
  );
  return rows[0] || null;
}

async function requireContactSheetAdmin(env, data) {
  const expected = String(env.CONTACT_SHEETS_ADMIN_KEY || "");
  const received = String(data.adminKey || "");
  if (!expected) throw new Error("CONTACT_SHEETS_ADMIN_KEY is not configured");
  if (!received || !safeStringEqual(await sha256(expected), await sha256(received))) {
    throw new Error("Not authorized to prepare contact sheets");
  }
}

function uploadSigningSecret(env) {
  return String(env.CONTACT_SHEETS_UPLOAD_SIGNING_KEY || env.CONTACT_SHEETS_ADMIN_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");
}

async function createUploadNonce(env, payload) {
  const secret = uploadSigningSecret(env);
  if (!secret) throw new Error("Contact-sheet upload signing is not configured");
  const body = base64Url(textBytes(JSON.stringify({
    ...payload,
    exp: Date.now() + 60 * 60 * 1000,
    nonce: crypto.randomUUID()
  })));
  return `${body}.${await hmacSha256(body, secret)}`;
}

async function verifyUploadNonce(env, token, orderNumber) {
  const secret = uploadSigningSecret(env);
  const [body, signature] = String(token || "").split(".");
  if (!secret || !body || !signature) throw new Error("Upload session is invalid or has expired");
  const expected = await hmacSha256(body, secret);
  if (!safeStringEqual(signature, expected)) throw new Error("Upload session is invalid or has expired");

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))));
  } catch (error) {
    throw new Error("Upload session is invalid or has expired");
  }

  if (!payload.exp || Date.now() > Number(payload.exp)) throw new Error("Upload session has expired; prepare the contact sheets again");
  if (cleanText(payload.orderNumber) !== cleanText(orderNumber)) throw new Error("Upload session is invalid or has expired");
  if (!isUuid(payload.deliveryId)) throw new Error("Upload session is invalid or has expired");
  return payload;
}

async function verifyContactSheetAdmin(env, data) {
  await requireContactSheetAdmin(env, data || {});
  return {success: true};
}

async function beginContactSheetUpload(db, env, data) {
  await requireContactSheetAdmin(env, data || {});
  const orderNumber = cleanText(data.orderNumber);
  if (!orderNumber) return {error: "Order number is required"};

  const order = await getOrderRowByNumber(db, orderNumber);
  if (!order) return {error: "Save the order before preparing contact sheets"};

  const deliveryId = crypto.randomUUID();
  const uploadNonce = await createUploadNonce(env, {orderNumber, deliveryId});
  const existing = await db.select(
    "contact_sheets",
    `?select=roll_index,film_name,frame_count,landscape_url,portrait_url,status&order_id=eq.${encodeURIComponent(order.id)}&order=roll_index.asc`
  );

  return {
    success: true,
    deliveryId,
    uploadNonce,
    existingSheets: existing
      .filter(sheet => sheet.status === "ready")
      .map(contactSheetFromRow)
  };
}

async function requestContactSheetTicket(env, {deliveryId, rollIndex, variant}) {
  const settings = requireContactSheetSettings(env);
  if (!Number.isInteger(rollIndex) || rollIndex < 0 || rollIndex >= CONTACT_SHEETS_MAX_ROLLS) {
    return {error: "rollIndex must be an integer from 0 to 19"};
  }
  if (variant !== "delivery" && variant !== "story") {
    return {error: "variant must be delivery or story"};
  }

  const response = await fetch(`${settings.url}/v1/upload-ticket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.secret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      lab: "bali",
      deliveryId,
      rollIndex,
      variant
    })
  });
  const result = await response.json().catch(() => ({error: "The contact-sheet Worker returned an invalid response"}));
  if (!response.ok) {
    return {error: result.error || `Contact-sheet Worker error ${response.status}`, status: response.status};
  }
  return result;
}

async function createContactSheetUploadTicket(db, env, data) {
  const orderNumber = cleanText(data.orderNumber);
  const session = await verifyUploadNonce(env, data.uploadNonce, orderNumber);
  const order = await getOrderRowByNumber(db, orderNumber);
  if (!order) return {error: "Order not found"};
  return requestContactSheetTicket(env, {
    deliveryId: session.deliveryId,
    rollIndex: Number(data.rollIndex),
    variant: cleanText(data.variant).toLowerCase()
  });
}

async function createContactSheetUploadTickets(db, env, data) {
  const orderNumber = cleanText(data.orderNumber);
  const session = await verifyUploadNonce(env, data.uploadNonce, orderNumber);
  const order = await getOrderRowByNumber(db, orderNumber);
  if (!order) return {error: "Order not found"};

  const requests = Array.isArray(data.requests) ? data.requests : [];
  const tickets = [];
  for (const request of requests) {
    const ticket = await requestContactSheetTicket(env, {
      deliveryId: session.deliveryId,
      rollIndex: Number(request.rollIndex),
      variant: cleanText(request.variant).toLowerCase()
    });
    if (ticket.error) return ticket;
    tickets.push({
      ...ticket,
      rollIndex: Number(request.rollIndex),
      variant: cleanText(request.variant).toLowerCase()
    });
  }
  return {success: true, tickets};
}

async function uploadContactSheetFile(db, env, data, request) {
  const orderNumber = cleanText(data.orderNumber);
  const session = await verifyUploadNonce(env, data.uploadNonce, orderNumber);
  const order = await getOrderRowByNumber(db, orderNumber);
  if (!order) return {error: "Order not found"};

  const rollIndex = Number(data.rollIndex);
  const variant = cleanText(data.variant).toLowerCase();
  const ticket = await requestContactSheetTicket(env, {
    deliveryId: session.deliveryId,
    rollIndex,
    variant
  });
  if (ticket.error) return ticket;

  const uploadResponse = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": request.headers.get("Content-Type") || "image/jpeg",
      Origin: cleanText(env.DISPATCH_PUBLIC_ORIGIN) || "https://bali-darkroom.saujanalab.com"
    },
    body: await request.arrayBuffer()
  });
  if (!uploadResponse.ok) {
    const text = await uploadResponse.text().catch(() => "");
    return {
      error: `Upload failed (${uploadResponse.status})`,
      detail: text.slice(0, 240),
      status: uploadResponse.status
    };
  }
  return {
    success: true,
    rollIndex,
    variant,
    fileUrl: ticket.fileUrl
  };
}

async function routeBinaryAction(action, data, db, env, request) {
  switch (action) {
    case "uploadContactSheetFile":
      return uploadContactSheetFile(db, env, data, request);
    default:
      return null;
  }
}

function validateContactSheetFileUrl(value, workerUrl) {
  const url = String(value || "").trim();
  const prefix = workerUrl.replace(/\/$/, "") + "/v1/files/";
  if (!url.startsWith(prefix) || url.includes("?") || url.includes("#")) {
    throw new Error("Invalid contact-sheet file URL");
  }
  return url;
}

function sanitizeContactSheets(input, workerUrl) {
  if (!Array.isArray(input)) throw new Error("contactSheets must be an array");
  if (input.length > CONTACT_SHEETS_MAX_ROLLS) throw new Error("Too many contact sheets");
  const seen = new Set();

  return input.map((sheet, position) => {
    const rollIndex = Number(sheet.rollIndex);
    if (!Number.isInteger(rollIndex) || rollIndex < 0 || rollIndex >= CONTACT_SHEETS_MAX_ROLLS) {
      throw new Error(`Invalid rollIndex at contact sheet ${position + 1}`);
    }
    if (seen.has(rollIndex)) throw new Error(`Duplicate contact sheet rollIndex ${rollIndex}`);
    seen.add(rollIndex);

    const scanStyle = cleanText(sheet.scanStyle || "classic").toLowerCase();
    const format = cleanText(sheet.format || "full-frame").toLowerCase();
    if (!CONTACT_SHEETS_ALLOWED_STYLES.has(scanStyle)) throw new Error("Invalid scanSAUce style");
    if (!CONTACT_SHEETS_ALLOWED_FORMATS.has(format)) throw new Error("Invalid film format");

    return {
      rollIndex,
      filmName: cleanText(sheet.filmName || sheet.rollName || `Roll ${rollIndex + 1}`).slice(0, 120),
      frameCount: Math.max(0, Math.min(200, Math.round(Number(sheet.frameCount) || 0))),
      scanStyle,
      format,
      deliveryUrl: validateContactSheetFileUrl(sheet.deliveryUrl, workerUrl),
      storyUrl: validateContactSheetFileUrl(sheet.storyUrl, workerUrl)
    };
  }).sort((a, b) => a.rollIndex - b.rollIndex);
}

async function completeContactSheetUpload(db, env, data) {
  const orderNumber = cleanText(data.orderNumber);
  const session = await verifyUploadNonce(env, data.uploadNonce, orderNumber);
  const settings = requireContactSheetSettings(env);
  const order = await getOrderRowByNumber(db, orderNumber);
  if (!order) return {error: "Order not found"};

  const sheets = sanitizeContactSheets(data.contactSheets || [], settings.url);
  await db.delete("contact_sheets", `?order_id=eq.${encodeURIComponent(order.id)}`);
  if (sheets.length) {
    await db.insert("contact_sheets", sheets.map(sheet => ({
      order_id: order.id,
      roll_index: sheet.rollIndex,
      film_name: sheet.filmName,
      frame_count: sheet.frameCount,
      landscape_url: sheet.deliveryUrl,
      portrait_url: sheet.storyUrl,
      status: "ready",
      worker_job_id: session.deliveryId,
      published_at: nowIso()
    })), {returning: "minimal"});
  }
  await db.update("orders", `?id=eq.${encodeURIComponent(order.id)}`, {
    contact_sheets_enabled: sheets.length > 0
  });
  return {success: true, order: await getOrderByNumber(db, {orderNumber})};
}

async function cancelContactSheetUpload(db, env, data) {
  await verifyUploadNonce(env, data.uploadNonce, cleanText(data.orderNumber));
  return {success: true};
}

async function prepareContactSheetPublish(db, env, data) {
  await requireContactSheetAdmin(env, data || {});
  const requests = Array.isArray(data.requests) ? data.requests : [];
  const orderPayload = {
    ...data,
    contactSheetsEnabled: requests.length > 0
  };
  const saved = await addOrder(db, orderPayload);
  if (!saved || saved.error) return saved;

  const orderNumber = cleanText(data.orderNumberText || data.orderNumber);
  const deliveryId = crypto.randomUUID();
  const uploadNonce = await createUploadNonce(env, {orderNumber, deliveryId});
  const tickets = [];
  for (const request of requests) {
    const ticket = await requestContactSheetTicket(env, {
      deliveryId,
      rollIndex: Number(request.rollIndex),
      variant: cleanText(request.variant).toLowerCase()
    });
    if (ticket.error) return ticket;
    tickets.push({
      ...ticket,
      rollIndex: Number(request.rollIndex),
      variant: cleanText(request.variant).toLowerCase()
    });
  }
  return {success: true, order: saved, uploadNonce, tickets};
}

async function addOrder(db, data) {
  const orderNumber = cleanText(data.orderNumber || data.orderNumberText);
  const customerName = cleanText(data.customerName);
  if (!orderNumber) return {error: "Missing order number"};
  if (!customerName) return {error: "Missing customer name"};

  let customer = null;
  const legacyCustomerId = cleanText(data.customerId);
  if (legacyCustomerId) {
    const filters = [eqFilter("legacy_customer_id", legacyCustomerId)];
    if (isUuid(legacyCustomerId)) filters.push(eqFilter("id", legacyCustomerId));
    const customers = await db.select(
      "customers",
      `?select=id,legacy_customer_id,email,phone&or=(${filters.join(",")})&limit=1`
    );
    customer = customers[0] || null;
  }

  const legacyOrderId = cleanText(data.id) || `o_${Date.now()}`;
  const rows = await db.insert("orders", [{
    legacy_order_id: legacyOrderId,
    order_number: orderNumber,
    customer_id: customer?.id || null,
    legacy_customer_id: legacyCustomerId || customer?.legacy_customer_id || null,
    customer_name: customerName,
    customer_email: cleanText(data.customerEmail) || customer?.email || null,
    customer_phone: cleanText(data.customerPhone) || customer?.phone || null,
    delivery_display_name: cleanText(data.deliveryName || data.deliveryDisplayName) || null,
    film: cleanText(data.film || data.deliveryFilm) || null,
    notes: cleanText(data.notes) || null,
    drive_link: cleanText(data.driveLink) || null,
    delivery_url: cleanText(data.deliveryUrl) || null,
    contact_sheets_enabled: Boolean(data.contactSheets?.length || data.contactSheetsEnabled)
  }]);

  const order = rows[0];
  const extraEmails = Array.isArray(data.extraEmails) ? data.extraEmails : [];
  const recipientRows = [
    cleanText(data.customerEmail || data.email || customer?.email),
    ...extraEmails.map(cleanText)
  ].filter(Boolean).map((email, index) => ({
    order_id: order.id,
    email,
    is_primary: index === 0
  }));
  if (recipientRows.length) await db.insert("order_recipients", recipientRows, {returning: "minimal"});

  return orderFromRow(order);
}

async function getStock(db) {
  const rows = await db.select(
    "stock_items",
    "?select=id,category,name,qty,visible,last_updated&order=category.asc,name.asc"
  );
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.category)) groups.set(row.category, []);
    groups.get(row.category).push({
      id: row.id,
      name: row.name,
      qty: Number(row.qty) || 0,
      visible: row.visible !== false,
      lastUpdated: row.last_updated || ""
    });
  }
  return Array.from(groups.entries()).map(([category, items]) => ({category, items}));
}

async function saveStock(db, data) {
  const stock = Array.isArray(data.stock) ? data.stock : [];
  const now = nowIso();
  const incoming = [];
  for (const group of stock) {
    const category = cleanText(group.category) || "Uncategorized";
    for (const item of group.items || []) {
      const name = cleanText(item.name);
      if (!name) continue;
      incoming.push({
        category,
        name,
        qty: safeInt(item.qty),
        visible: parseBoolean(item.visible, true),
        last_updated: now
      });
    }
  }

  if (!incoming.length) return {success: true, saved: 0, timestamp: now};

  const existing = await db.select("stock_items", "?select=id,category,name");
  const existingMap = new Map(existing.map(item => [
    `${String(item.category).toLowerCase()}::${String(item.name).toLowerCase()}`,
    item
  ]));
  let saved = 0;
  for (const item of incoming) {
    const key = `${item.category.toLowerCase()}::${item.name.toLowerCase()}`;
    const match = existingMap.get(key);
    if (match) {
      await db.update("stock_items", `?id=eq.${encodeURIComponent(match.id)}`, item);
    } else {
      await db.insert("stock_items", [item], {returning: "minimal"});
    }
    saved += 1;
  }
  return {success: true, saved, timestamp: now};
}

async function getStockHistory(db) {
  const rows = await db.select(
    "stock_count_sessions",
    "?select=legacy_history_id,action,report,before_stock,after_stock,created_at&order=created_at.desc&limit=100"
  );
  return rows.map(row => ({
    id: row.legacy_history_id,
    timestamp: row.created_at,
    action: row.action,
    report: row.report || "",
    beforeStock: row.before_stock,
    afterStock: row.after_stock
  }));
}

async function recordStockHistory(db, data) {
  const now = nowIso();
  const legacyId = cleanText(data.id) || `sh_${Date.now()}`;
  await db.upsert("stock_count_sessions", [{
    legacy_history_id: legacyId,
    action: cleanText(data.action) || "finalize",
    before_stock: data.beforeStock || null,
    after_stock: data.afterStock || null,
    report: cleanText(data.report) || null,
    created_at: cleanText(data.timestamp) || now
  }], "legacy_history_id");
  return {success: true, id: legacyId, timestamp: now};
}

async function finalizeStock(db, data) {
  const saved = await saveStock(db, {stock: data.stock || data.afterStock || []});
  const history = await recordStockHistory(db, {
    id: data.historyId,
    timestamp: saved.timestamp,
    action: data.action || "finalize",
    beforeStock: data.beforeStock || [],
    afterStock: data.afterStock || data.stock || [],
    report: data.report || ""
  });
  return {
    ...saved,
    history: {
      id: history.id,
      timestamp: history.timestamp,
      action: data.action || "finalize",
      beforeStock: data.beforeStock || [],
      afterStock: data.afterStock || data.stock || [],
      report: data.report || ""
    }
  };
}

async function exportData(db, env, data) {
  try {
    await requireContactSheetAdmin(env, data);
  } catch (error) {
    throw new Error("Not authorized to export data");
  }
  const exportedAt = nowIso();
  const dateSlug = exportedAt.slice(0, 10);
  const [
    customers,
    orders,
    recipients,
    stockItems,
    stockHistory
  ] = await Promise.all([
    db.select("customers", "?select=id,legacy_customer_id,name,email,phone,source,created_at&order=created_at.desc&limit=10000"),
    db.select("orders", "?select=id,legacy_order_id,order_number,legacy_customer_id,customer_name,customer_email,customer_phone,delivery_display_name,film,notes,drive_link,delivery_url,contact_sheets_enabled,created_at&order=created_at.desc&limit=10000"),
    db.select("order_recipients", "?select=order_id,email,is_primary&order=is_primary.desc,email.asc&limit=10000"),
    db.select("stock_items", "?select=category,name,qty,visible,last_updated&order=category.asc,name.asc&limit=10000"),
    db.select("stock_count_sessions", "?select=legacy_history_id,created_at,action,report,before_stock,after_stock&order=created_at.desc&limit=10000")
  ]);

  const recipientsByOrder = new Map();
  for (const recipient of recipients) {
    const key = recipient.order_id;
    if (!recipientsByOrder.has(key)) recipientsByOrder.set(key, []);
    recipientsByOrder.get(key).push(recipient);
  }

  const files = [
    {
      label: "Customers",
      fileName: `saujana-bali-customers-${dateSlug}.csv`,
      mimeType: "text/csv;charset=utf-8",
      rowCount: customers.length,
      content: csvFile(
        ["ID", "Name", "Email", "Phone", "Date Added", "Source", "Supabase ID"],
        customers.map(row => ({
          "ID": row.legacy_customer_id || row.id,
          "Name": row.name,
          "Email": row.email,
          "Phone": row.phone,
          "Date Added": row.created_at,
          "Source": row.source,
          "Supabase ID": row.id
        }))
      )
    },
    {
      label: "Orders",
      fileName: `saujana-bali-orders-${dateSlug}.csv`,
      mimeType: "text/csv;charset=utf-8",
      rowCount: orders.length,
      content: csvFile(
        ["ID", "Order Number", "Customer ID", "Customer Name", "Email", "Phone", "Additional Emails", "Film", "Notes", "Drive Link", "Delivery URL", "Contact Sheets", "Date", "Supabase ID"],
        orders.map(row => {
          const orderRecipients = recipientsByOrder.get(row.id) || [];
          const primary = orderRecipients.find(recipient => recipient.is_primary);
          const extras = orderRecipients
            .filter(recipient => !recipient.is_primary)
            .map(recipient => recipient.email)
            .filter(Boolean);
          return {
            "ID": row.legacy_order_id || row.id,
            "Order Number": String(row.order_number || ""),
            "Customer ID": row.legacy_customer_id || "",
            "Customer Name": row.customer_name,
            "Email": row.customer_email || primary?.email || "",
            "Phone": row.customer_phone,
            "Additional Emails": extras.join(", "),
            "Film": row.film,
            "Notes": row.notes,
            "Drive Link": row.drive_link,
            "Delivery URL": row.delivery_url,
            "Contact Sheets": row.contact_sheets_enabled ? "TRUE" : "FALSE",
            "Date": row.created_at,
            "Supabase ID": row.id
          };
        })
      )
    },
    {
      label: "Stock",
      fileName: `saujana-bali-stock-${dateSlug}.csv`,
      mimeType: "text/csv;charset=utf-8",
      rowCount: stockItems.length,
      content: csvFile(
        ["Category", "Item", "Quantity", "Visible", "Last Updated"],
        stockItems.map(row => ({
          "Category": row.category,
          "Item": row.name,
          "Quantity": Number(row.qty) || 0,
          "Visible": row.visible === false ? "FALSE" : "TRUE",
          "Last Updated": row.last_updated
        }))
      )
    },
    {
      label: "Stock History",
      fileName: `saujana-bali-stock-history-${dateSlug}.csv`,
      mimeType: "text/csv;charset=utf-8",
      rowCount: stockHistory.length,
      content: csvFile(
        ["ID", "Timestamp", "Action", "Report", "Before Stock JSON", "After Stock JSON"],
        stockHistory.map(row => ({
          "ID": row.legacy_history_id,
          "Timestamp": row.created_at,
          "Action": row.action,
          "Report": row.report,
          "Before Stock JSON": row.before_stock,
          "After Stock JSON": row.after_stock
        }))
      )
    }
  ];

  return {success: true, exportedAt, files};
}

async function routeAction(action, data, db, env) {
  switch (action) {
    case "dispatchHealthcheck":
    case "healthcheck":
      return db.rpc("dispatch_healthcheck");
    case "getCustomers":
      return getCustomers(db);
    case "getInitialData":
      return getInitialData(db);
    case "addCustomer":
      return addCustomer(db, data);
    case "updateCustomer":
      return updateCustomer(db, data);
    case "deleteCustomer":
      return deleteCustomer(db, data);
    case "getOrders":
      return getOrders(db);
    case "getOrder":
    case "getOrderByNumber":
      return getOrderByNumber(db, data);
    case "addOrder":
      return addOrder(db, data);
    case "verifyContactSheetAdmin":
      return verifyContactSheetAdmin(env, data);
    case "prepareContactSheetPublish":
      return prepareContactSheetPublish(db, env, data);
    case "beginContactSheetUpload":
      return beginContactSheetUpload(db, env, data);
    case "createContactSheetUploadTicket":
      return createContactSheetUploadTicket(db, env, data);
    case "createContactSheetUploadTickets":
      return createContactSheetUploadTickets(db, env, data);
    case "completeContactSheetUpload":
      return completeContactSheetUpload(db, env, data);
    case "cancelContactSheetUpload":
      return cancelContactSheetUpload(db, env, data);
    case "getStock":
      return getStock(db);
    case "saveStock":
      return saveStock(db, data);
    case "getStockHistory":
      return getStockHistory(db);
    case "recordStockHistory":
      return recordStockHistory(db, data);
    case "finalizeStock":
      return finalizeStock(db, data);
    case "exportData":
      return exportData(db, env, data);
    default:
      return {error: `Unknown action: ${action}`};
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {headers: CORS_HEADERS});
    }

    try {
      const url = new URL(request.url);
      const action = cleanText(url.searchParams.get("action"));
      if (!action) return json({error: "Missing action"}, {status: 400});

      const db = new SupabaseClient(env);
      const queryData = payloadFromQuery(url);
      const binaryResult = await routeBinaryAction(action, queryData, db, env, request);
      if (binaryResult) return json(binaryResult);

      const data = {
        ...queryData,
        ...(await readPayload(request))
      };
      const result = await routeAction(action, data, db, env);
      return json(result);
    } catch (error) {
      return json({error: error.message || String(error)}, {status: 500});
    }
  }
};
