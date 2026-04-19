/**
 * migrate-data.ts
 *
 * Reads JSON exports from your Google Sheets and inserts them into Neon PostgreSQL.
 *
 * USAGE:
 * 1. Export each Google Sheet tab as JSON (or use the Apps Script API):
 *    - Products → products.json
 *    - Sales_Bills → sales_bills.json
 *    - Sales_Lines → sales_lines.json
 *    - Purchase_Transactions → purchases.json
 *    - Stock_Ledger → stock_ledger.json
 *    - System_Config → system_config.json
 *    - Users → users.json
 *
 *    Easiest way: open each sheet tab → File → Download → CSV, then convert to JSON
 *    OR hit your Apps Script:
 *      fetch(WEB_APP_URL + '?action=listProducts&limit=99999')
 *      fetch(WEB_APP_URL + '?action=listBills&limit=99999')
 *    and save the responses.
 *
 * 2. Place the JSON files in server/data/  (create the folder)
 * 3. Run:  cd server && npm run migrate
 */

import sql from './db';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function num(v: any): number { const n = Number(v); return isNaN(n) ? 0 : n; }

function readJson(filename: string): any[] {
  const fp = path.join(__dirname, 'data', filename);
  if (!fs.existsSync(fp)) { console.log(`  ⏭  ${filename} not found, skipping`); return []; }
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}

async function main() {
  console.log('🚀 Starting data migration to Neon PostgreSQL...\n');

  // --- System Config ---
  const configs = readJson('system_config.json');
  for (const c of configs) {
    const key = c.Key || c.key;
    const value = c.Value || c.value || '';
    if (!key) continue;
    await sql`INSERT INTO system_config (key, value) VALUES (${key}, ${String(value)}) ON CONFLICT (key) DO UPDATE SET value = ${String(value)}`;
  }
  console.log(`✅ system_config: ${configs.length} rows`);

  // --- Users ---
  const users = readJson('users.json');
  for (const u of users) {
    const username = u.Username || u.username;
    const password = u.Password || u.password || '';
    const role = u.Role || u.role || 'STAFF';
    if (!username) continue;
    await sql`INSERT INTO users (username, password, role) VALUES (${username}, ${password}, ${role}) ON CONFLICT (username) DO NOTHING`;
  }
  console.log(`✅ users: ${users.length} rows`);

  // --- Products ---
  const products = readJson('products.json');
  for (const p of products) {
    const id = p.ID || p.id;
    if (!id) continue;
    await sql`INSERT INTO products (id, name, category, unit, cost, selling, stock, min_stock, vendor, updated_at)
      VALUES (${id}, ${p.Name || p.name || ''}, ${p.Category || p.category || 'General'}, ${p.Unit || p.unit || 'Pcs'},
              ${num(p.Cost || p.cost)}, ${num(p.Selling || p.selling)}, ${num(p.Stock || p.stock)},
              ${num(p.MinStock || p.min_stock || p.minStock)}, ${p.Vendor || p.vendor || ''}, NOW())
      ON CONFLICT (id) DO NOTHING`;
  }
  console.log(`✅ products: ${products.length} rows`);

  // --- Sales Bills ---
  const bills = readJson('sales_bills.json');
  for (const b of bills) {
    const billNo = b.BillNo || b.bill_no;
    if (!billNo) continue;
    await sql`INSERT INTO sales_bills (bill_no, date_time, customer_name, customer_contact, method, transfer_id, "user", subtotal, gst_total, grand_total, status, updated_at)
      VALUES (${billNo}, ${b.DateTime || b.date_time || new Date().toISOString()}, ${b.CustomerName || b.customer_name || ''},
              ${b.CustomerContact || b.customer_contact || ''}, ${b.Method || b.method || ''}, ${b.TransferId || b.transfer_id || ''},
              ${b.User || b.user || ''}, ${num(b.Subtotal || b.subtotal)}, ${num(b.GSTTotal || b.gst_total)},
              ${num(b.GrandTotal || b.grand_total)}, ${b.Status || b.status || 'ACTIVE'}, NOW())
      ON CONFLICT (bill_no) DO NOTHING`;
  }
  console.log(`✅ sales_bills: ${bills.length} rows`);

  // --- Sales Lines ---
  const lines = readJson('sales_lines.json');
  for (const ln of lines) {
    const lineId = ln.LineId || ln.line_id || crypto.randomUUID();
    const billNo = ln.BillNo || ln.bill_no;
    if (!billNo) continue;
    await sql`INSERT INTO sales_lines (line_id, bill_no, date_time, item_id, item_name, qty, rate, unit_cost, line_type, gst_rate, gst_amount, line_total, "user", status, updated_at)
      VALUES (${lineId}, ${billNo}, ${ln.DateTime || ln.date_time || new Date().toISOString()}, ${ln.ItemID || ln.item_id || ''},
              ${ln.ItemName || ln.item_name || ''}, ${num(ln.Qty || ln.qty)}, ${num(ln.Rate || ln.rate)}, ${num(ln.UnitCost || ln.unit_cost)},
              ${ln.LineType || ln.line_type || 'SALE'}, ${num(ln.GST_Rate || ln.gst_rate)}, ${num(ln.GST_Amount || ln.gst_amount)},
              ${num(ln.LineTotal || ln.line_total)}, ${ln.User || ln.user || ''}, ${ln.Status || ln.status || 'ACTIVE'}, NOW())
      ON CONFLICT (line_id) DO NOTHING`;
  }
  console.log(`✅ sales_lines: ${lines.length} rows`);

  // --- Purchases ---
  const purchases = readJson('purchases.json');
  for (const p of purchases) {
    await sql`INSERT INTO purchase_transactions (date_time, bill_no, supplier, item_id, item_name, qty, cost, total, "user", status, updated_at)
      VALUES (${p.DateTime || p.date_time || new Date().toISOString()}, ${p.BillNo || p.bill_no || ''},
              ${p.Supplier || p.supplier || ''}, ${p.ItemID || p.item_id || ''}, ${p.ItemName || p.item_name || ''},
              ${num(p.Qty || p.qty)}, ${num(p.Cost || p.cost)}, ${num(p.Total || p.total)},
              ${p.User || p.user || ''}, ${p.Status || p.status || 'ACTIVE'}, NOW())`;
  }
  console.log(`✅ purchases: ${purchases.length} rows`);

  console.log('\n🎉 Migration complete!');
}

main().catch(err => { console.error('❌ Migration failed:', err); process.exit(1); });
