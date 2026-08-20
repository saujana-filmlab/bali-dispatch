# Bali Dispatch API Worker

Cloudflare Worker replacement engine for the Bali Darkroom Dispatch Apps Script backend.

## Required Secrets

Set these in Cloudflare Worker settings before deploy:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CONTACT_SHEETS_ADMIN_KEY`
- `CONTACT_SHEETS_WORKER_URL`
- `CONTACT_SHEETS_WORKER_SECRET`
- `CONTACT_SHEETS_UPLOAD_SIGNING_KEY`

For local development, copy `.dev.vars.example` to `.dev.vars` and fill the same values.

## First Endpoints

The Worker mirrors the old Apps Script `?action=` API shape:

- `dispatchHealthcheck`
- `getCustomers`
- `addCustomer`
- `updateCustomer`
- `deleteCustomer`
- `getOrders`
- `getOrder`
- `getOrderByNumber`
- `addOrder`
- `verifyContactSheetAdmin`
- `prepareContactSheetPublish`
- `beginContactSheetUpload`
- `createContactSheetUploadTicket`
- `createContactSheetUploadTickets`
- `completeContactSheetUpload`
- `cancelContactSheetUpload`
- `getStock`
- `saveStock`
- `finalizeStock`
- `getStockHistory`
- `recordStockHistory`

Drive folder creation and delivery email stay on the old backend until their Google secrets are configured.
