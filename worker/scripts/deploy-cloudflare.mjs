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

function readDotenv(file) {
  const values = {};
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const token = readTomlValue(".wrangler-config/.wrangler/config/default.toml", "oauth_token");
if (!token) throw new Error("Missing Cloudflare OAuth token. Run wrangler login first.");

const env = readDotenv(".dev.vars");
for (const key of [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CONTACT_SHEETS_ADMIN_KEY",
  "CONTACT_SHEETS_WORKER_URL",
  "CONTACT_SHEETS_WORKER_SECRET",
  "CONTACT_SHEETS_UPLOAD_SIGNING_KEY",
]) {
  if (!env[key]) throw new Error(`Missing ${key} in .dev.vars`);
}

const metadata = {
  main_module: "index.js",
  compatibility_date: "2026-08-01",
  compatibility_flags: ["global_fetch_strictly_public"],
  bindings: [
    { type: "plain_text", name: "SUPABASE_SCHEMA", text: "public" },
    { type: "secret_text", name: "SUPABASE_URL", text: env.SUPABASE_URL },
    {
      type: "secret_text",
      name: "SUPABASE_SERVICE_ROLE_KEY",
      text: env.SUPABASE_SERVICE_ROLE_KEY,
    },
    {
      type: "secret_text",
      name: "CONTACT_SHEETS_ADMIN_KEY",
      text: env.CONTACT_SHEETS_ADMIN_KEY,
    },
    {
      type: "secret_text",
      name: "CONTACT_SHEETS_WORKER_URL",
      text: env.CONTACT_SHEETS_WORKER_URL,
    },
    {
      type: "secret_text",
      name: "CONTACT_SHEETS_WORKER_SECRET",
      text: env.CONTACT_SHEETS_WORKER_SECRET,
    },
    {
      type: "secret_text",
      name: "CONTACT_SHEETS_UPLOAD_SIGNING_KEY",
      text: env.CONTACT_SHEETS_UPLOAD_SIGNING_KEY,
    },
  ],
};

const form = new FormData();
form.append(
  "metadata",
  new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  "metadata.json",
);
form.append(
  "index.js",
  new Blob([fs.readFileSync("src/index.js", "utf8")], {
    type: "application/javascript+module",
  }),
  "index.js",
);

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}`,
  {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  },
);

const body = await response.json().catch(async () => ({ raw: await response.text() }));
console.log(
  JSON.stringify(
    {
      status: response.status,
      success: body.success,
      errors: body.errors,
      messages: body.messages,
      result: body.result
        ? {
            id: body.result.id,
            created_on: body.result.created_on,
            modified_on: body.result.modified_on,
          }
        : undefined,
    },
    null,
    2,
  ),
);

if (!response.ok || !body.success) process.exit(1);
