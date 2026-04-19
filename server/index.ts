import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import sql from './db';
import crypto from 'crypto';

dotenv.config({ path: __dirname + '/../.env' });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.text()); // support plain-text bodies (the old frontend sends JSON as text sometimes)

const PORT = parseInt(process.env.PORT || '3001', 10);

/* ===== helpers ===== */
function num(v: any): number { const n = Number(v); return isNaN(n) ? 0 : n; }

/* ===================================================================
   ACTION HANDLERS — keyed by action name, matching the old Code.gs API
   =================================================================== */

type Handler = (params: Record<string, any>) => Promise<any>;

const getHandlers: Record<string, Handler> = {
  ping: async () => ({ success: true, message: 'pong' }),
  getConfig: async () => {
    const rows = await sql`SELECT key, value FROM system_config`;
    const config: Record<string, any> = {};
    for (const r of rows) {
      if (r.key === 'staff_perms') { try { config[r.key] = JSON.parse(r.value); } catch { config[r.key] = {}; } }
      else if (['gst_rate', 'bill_no_seed', 'product_id_seed'].includes(r.key)) config[r.key] = parseFloat(r.value);
      else config[r.key] = r.value;
    }
    if (!config.bill_prefix) config.bill_prefix = 'BILL-';
    if (!config.gst_rate && config.gst_rate !== 0) config.gst_rate = 0.05;
    if (!config.bill_no_seed) config.bill_no_seed = 1;
    if (!config.staff_perms) config.staff_perms = {};
    return config;
  },
  login: async (p) => {
    const rows = await sql`SELECT username, role FROM users WHERE username = ${p.username} AND password = ${p.password}`;
    if (rows.length) return { success: true, user: { username: rows[0].username, role: rows[0].role } };
    return { success: false, error: 'Invalid credentials' };
  },
  listProducts: async (p) => {
    const q = String(p.q || '');
    const limit = parseInt(String(p.limit || '100'), 10);
    const start = parseInt(String(p.start || '0'), 10);
    let rows;
    if (q) { const pattern = `%${q}%`; rows = await sql`SELECT * FROM products WHERE id ILIKE ${pattern} OR name ILIKE ${pattern} OR category ILIKE ${pattern} ORDER BY name LIMIT ${limit} OFFSET ${start}`; }
    else { rows = await sql`SELECT * FROM products ORDER BY name LIMIT ${limit} OFFSET ${start}`; }
    return rows.map(toProduct);
  },
  getProduct: async (p) => {
    const id = String(p.productId || '');
    if (!id) return null;
    const rows = await sql`SELECT * FROM products WHERE id = ${id}`;
    return rows.length ? toProduct(rows[0]) : null;
  },
  listCategories: async () => {
    await sql`CREATE TABLE IF NOT EXISTS categories (name TEXT PRIMARY KEY)`;
    const rows = await sql`SELECT DISTINCT c FROM (SELECT category AS c FROM products WHERE category != '' UNION SELECT name AS c FROM categories) sub ORDER BY c`;
    return rows.map((r: any) => r.c);
  },
  listBills: async (p) => {
    const limit = parseInt(String(p.limit || '100'), 10);
    const offset = parseInt(String(p.offset || '0'), 10);
    const start = p.start ? String(p.start) : null;
    const end = p.end ? String(p.end) : null;
    const billNo = p.billNo ? String(p.billNo).toLowerCase() : null;
    let rows;
    if (billNo && start && end) rows = await sql`SELECT * FROM sales_bills WHERE LOWER(bill_no) LIKE ${'%' + billNo + '%'} AND date_time::date >= ${start}::date AND date_time::date <= ${end}::date ORDER BY date_time DESC LIMIT ${limit} OFFSET ${offset}`;
    else if (billNo) rows = await sql`SELECT * FROM sales_bills WHERE LOWER(bill_no) LIKE ${'%' + billNo + '%'} ORDER BY date_time DESC LIMIT ${limit} OFFSET ${offset}`;
    else if (start && end) rows = await sql`SELECT * FROM sales_bills WHERE date_time::date >= ${start}::date AND date_time::date <= ${end}::date ORDER BY date_time DESC LIMIT ${limit} OFFSET ${offset}`;
    else rows = await sql`SELECT * FROM sales_bills ORDER BY date_time DESC LIMIT ${limit} OFFSET ${offset}`;
    return rows.map(toBill);
  },
  getBill: async (p) => {
    const billNo = String(p.billNo || '');
    if (!billNo) return null;
    const bRows = await sql`SELECT * FROM sales_bills WHERE bill_no = ${billNo}`;
    if (!bRows.length) return null;
    const lRows = await sql`SELECT * FROM sales_lines WHERE bill_no = ${billNo} AND status = 'ACTIVE'`;
    const bill = toBill(bRows[0]);
    (bill as any).lines = lRows.map(toLine);
    return bill;
  },
  getDashboardData: async () => {
    // Run all queries in parallel using SQL aggregations instead of full table scans
    const [lowStockRows, categoryRows, billSummary, monthlyRows, paymentRows, itemsSoldRow] = await Promise.all([
      sql`SELECT id, name, category, unit, cost, selling, stock, min_stock, vendor, updated_at FROM products WHERE stock <= min_stock`,
      sql`SELECT COALESCE(p.category, 'Unknown') AS name, SUM(sl.line_total) AS value FROM sales_lines sl LEFT JOIN products p ON p.id = sl.item_id WHERE sl.status = 'ACTIVE' AND sl.line_type = 'SALE' GROUP BY p.category`,
      sql`SELECT COALESCE(SUM(grand_total), 0) AS total_sales, COUNT(*) AS total_transactions FROM sales_bills WHERE status = 'ACTIVE' AND ABS(grand_total) <= 1e9`,
      sql`SELECT TO_CHAR(date_time, 'YYYY-MM') AS month, SUM(grand_total) AS value FROM sales_bills WHERE status = 'ACTIVE' AND ABS(grand_total) <= 1e9 GROUP BY TO_CHAR(date_time, 'YYYY-MM') ORDER BY month`,
      sql`SELECT COALESCE(method, 'UNKNOWN') AS name, SUM(grand_total) AS value FROM sales_bills WHERE status = 'ACTIVE' AND ABS(grand_total) <= 1e9 GROUP BY method`,
      sql`SELECT COALESCE(SUM(qty), 0) AS total FROM sales_lines WHERE status = 'ACTIVE' AND line_type = 'SALE'`,
    ]);
    const lowStock = lowStockRows.map(toProduct);
    const chartData = categoryRows.map((r: any) => ({ name: r.name || 'Unknown', value: num(r.value) }));
    const totalSales = num(billSummary[0]?.total_sales);
    const totalTransactions = num(billSummary[0]?.total_transactions);
    const totalItemsSold = num(itemsSoldRow[0]?.total);
    const monthlySales = monthlyRows.map((r: any) => { const [y, m] = String(r.month).split('-'); const d = new Date(Number(y), Number(m) - 1, 1); return { month: r.month, name: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), value: num(r.value) }; });
    const paymentMethods = paymentRows.map((r: any) => ({ name: r.name || 'UNKNOWN', value: num(r.value) }));
    return { lowStock, chartData, monthlySales, paymentMethods, totalSales, totalTransactions, totalItemsSold };
  },
  getProfitData: async (p) => {
    const startMonth = p.startMonth || null; const endMonth = p.endMonth || null;
    // Run all 4 queries in parallel
    const [products, purchases, billRows, lineRows] = await Promise.all([
      sql`SELECT id, cost FROM products`,
      sql`SELECT item_id, cost FROM purchase_transactions`,
      sql`SELECT bill_no, date_time, grand_total FROM sales_bills WHERE status = 'ACTIVE'`,
      sql`SELECT bill_no, item_id, qty, unit_cost FROM sales_lines WHERE status = 'ACTIVE' AND line_type = 'SALE'`,
    ]);
    const costMap: Record<string, number> = {}; products.forEach((r: any) => { costMap[r.id] = num(r.cost); });
    const purchaseCost: Record<string, number> = {}; purchases.forEach((r: any) => { purchaseCost[r.item_id] = num(r.cost); });
    const bills = billRows.map((r: any) => ({ BillNo: r.bill_no, DateTime: r.date_time, GrandTotal: num(r.grand_total) }));
    const activeBills: Record<string, string> = {}; const monthlyRevenue: Record<string, number> = {}; let totalRevenue = 0;
    for (const b of bills) {
      const dt = new Date(b.DateTime); const mk = !isNaN(dt.getTime()) ? dt.toISOString().slice(0, 7) : 'unknown';
      if (startMonth && mk < startMonth) continue; if (endMonth && mk > endMonth) continue;
      const grand = num(b.GrandTotal); if (Math.abs(grand) > 1e9) continue;
      activeBills[b.BillNo] = mk; monthlyRevenue[mk] = (monthlyRevenue[mk] || 0) + grand; totalRevenue += grand;
    }
    const lines = lineRows.map((r: any) => ({ BillNo: r.bill_no, ItemID: r.item_id, Qty: num(r.qty), UnitCost: num(r.unit_cost) }));
    const monthlyCogs: Record<string, number> = {}; let totalCogs = 0;
    for (const ln of lines) {
      const mk = activeBills[ln.BillNo]; if (!mk) continue;
      if (startMonth && mk < startMonth) continue; if (endMonth && mk > endMonth) continue;
      let uc = num(ln.UnitCost); if (!uc) uc = num(purchaseCost[ln.ItemID] || 0); if (!uc) uc = num(costMap[ln.ItemID] || 0);
      const lc = num(ln.Qty) * uc; monthlyCogs[mk] = (monthlyCogs[mk] || 0) + lc; totalCogs += lc;
    }
    const months = new Set([...Object.keys(monthlyRevenue), ...Object.keys(monthlyCogs)]);
    const monthlyProfit = [...months].filter(k => k !== 'unknown').sort().map(k => { const [y, m] = k.split('-'); const d = new Date(Number(y), Number(m) - 1, 1); return { month: k, name: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), profit: (monthlyRevenue[k] || 0) - (monthlyCogs[k] || 0) }; });
    return { totalRevenue, cogs: totalCogs, netProfit: totalRevenue - totalCogs, monthlyProfit };
  },
};

const postHandlers: Record<string, Handler> = {
  createBill: async () => {
    const cfgRows = await sql`SELECT key, value FROM system_config WHERE key IN ('bill_prefix', 'bill_no_seed')`;
    const cfg: Record<string, string> = {}; cfgRows.forEach((r: any) => { cfg[r.key] = r.value; });
    const prefix = cfg.bill_prefix || 'BILL-'; const seed = parseInt(cfg.bill_no_seed || '1', 10);
    const billNo = prefix + seed;
    await sql`INSERT INTO system_config (key, value) VALUES ('bill_no_seed', ${String(seed + 1)}) ON CONFLICT (key) DO UPDATE SET value = ${String(seed + 1)}`;
    return { billNo };
  },
  saveBill: async (body) => {
    const billNo = body.billNo || body.BillNo;
    const customerName = body.customerName || body.CustomerName || '';
    const method = body.method || body.Method || '';
    const user = body.user || body.User || '';
    const lines: any[] = body.lines || body.Lines || [];
    const customerContact = body.customerContact ?? body.CustomerContact ?? '';
    const transferId = body.transferId ?? body.TransferId ?? '';
    if (!billNo) return { success: false, error: 'billNo required' };
    const existing = await sql`SELECT status FROM sales_bills WHERE bill_no = ${billNo}`;
    if (existing.length && String(existing[0].status).toUpperCase() === 'LOCKED' && !body.force) return { success: false, error: 'Bill is locked and cannot be edited' };
    if (existing.length) await reverseBillLines(billNo, user);
    const products = await sql`SELECT id, cost FROM products`;
    const costMap: Record<string, number> = {}; products.forEach((p: any) => { costMap[String(p.id)] = num(p.cost); });
    let subtotal = 0, gstTotal = 0;
    // Pre-calculate totals
    const processedLines: { qty: number; rate: number; gstRate: number; gstAmount: number; lineTotal: number; unitCost: number; lineId: string; lineType: string; itemId: string; itemName: string; qtyChange: number }[] = [];
    for (const line of lines) {
      const qty = num(line.qty); const rate = num(line.rate); const gstRate = num(line.gstRate);
      const sign = String(line.lineType || 'SALE').toUpperCase() === 'RETURN' ? -1 : 1;
      const lineTotal = qty * rate; const gstAmount = lineTotal * gstRate;
      subtotal += sign * lineTotal; gstTotal += sign * gstAmount;
      const unitCost = num(costMap[String(line.itemId)] || 0); const lineId = crypto.randomUUID();
      const qtyChange = String(line.lineType || 'SALE').toUpperCase() === 'SALE' ? -qty : qty;
      processedLines.push({ qty, rate, gstRate, gstAmount, lineTotal, unitCost, lineId, lineType: line.lineType || 'SALE', itemId: line.itemId, itemName: line.itemName, qtyChange });
    }
    const grandTotal = subtotal + gstTotal; const newStatus = body.lock ? 'LOCKED' : 'ACTIVE';
    // Insert/update bill FIRST (parent row) so FK on sales_lines is satisfied
    await sql`INSERT INTO sales_bills (bill_no, date_time, customer_name, customer_contact, method, transfer_id, "user", subtotal, gst_total, grand_total, status, updated_at) VALUES (${billNo}, NOW(), ${customerName}, ${customerContact}, ${method}, ${transferId}, ${user}, ${subtotal}, ${gstTotal}, ${grandTotal}, ${newStatus}, NOW()) ON CONFLICT (bill_no) DO UPDATE SET customer_name = ${customerName}, customer_contact = ${customerContact}, method = ${method}, transfer_id = ${transferId}, "user" = ${user}, subtotal = ${subtotal}, gst_total = ${gstTotal}, grand_total = ${grandTotal}, status = ${newStatus}, updated_at = NOW()`;
    // Now insert lines
    for (const pl of processedLines) {
      await sql`INSERT INTO sales_lines (line_id, bill_no, date_time, item_id, item_name, qty, rate, unit_cost, line_type, gst_rate, gst_amount, line_total, "user", status, updated_at) VALUES (${pl.lineId}, ${billNo}, NOW(), ${pl.itemId}, ${pl.itemName}, ${pl.qty}, ${pl.rate}, ${pl.unitCost}, ${pl.lineType}, ${pl.gstRate}, ${pl.gstAmount}, ${pl.lineTotal}, ${user}, 'ACTIVE', NOW())`;
      await updateProductStock(pl.itemId, pl.qtyChange, user, 'SALE', billNo, pl.lineId, pl.gstRate, pl.gstAmount);
    }
    return { success: true, billNo };
  },
  reopenBill: async (body) => {
    const billNo = body.billNo; if (!billNo) return { success: false, error: 'billNo required' };
    const r = await sql`UPDATE sales_bills SET status = 'ACTIVE', updated_at = NOW() WHERE bill_no = ${billNo} RETURNING bill_no`;
    if (!r.length) return { success: false, error: 'Bill not found' };
    return { success: true, billNo };
  },
  updateBillContact: async (body) => {
    const billNo = body.billNo || body.BillNo;
    const customerContact = body.customerContact ?? body.CustomerContact ?? '';
    const transferId = body.transferId ?? body.TransferId ?? '';
    if (!billNo) return { success: false, error: 'billNo required' };
    const r = await sql`UPDATE sales_bills SET customer_contact = ${customerContact}, transfer_id = ${transferId}, updated_at = NOW() WHERE bill_no = ${billNo} RETURNING bill_no`;
    if (!r.length) return { success: false, error: 'Bill not found' };
    return { success: true, billNo };
  },
  saveProduct: async (body) => {
    const p = body.product || {};
    let id = p.ID || p.id;
    if (!id) {
      const seedRow = await sql`SELECT value FROM system_config WHERE key = 'product_id_seed'`;
      const seed = seedRow.length ? parseInt(seedRow[0].value, 10) : 1;
      id = 'A' + String(seed).padStart(3, '0');
      await sql`INSERT INTO system_config (key, value) VALUES ('product_id_seed', ${String(seed + 1)}) ON CONFLICT (key) DO UPDATE SET value = ${String(seed + 1)}`;
    }
    await sql`INSERT INTO products (id, name, category, unit, cost, selling, stock, min_stock, vendor, updated_at) VALUES (${id}, ${p.Name || ''}, ${p.Category || 'General'}, ${p.Unit || 'Pcs'}, ${num(p.Cost)}, ${num(p.Selling)}, ${num(p.Stock)}, ${num(p.MinStock)}, ${p.Vendor || ''}, NOW()) ON CONFLICT (id) DO UPDATE SET name = COALESCE(NULLIF(${p.Name || ''}, ''), products.name), category = COALESCE(NULLIF(${p.Category || ''}, ''), products.category), unit = COALESCE(NULLIF(${p.Unit || ''}, ''), products.unit), cost = ${num(p.Cost)}, selling = ${num(p.Selling)}, stock = ${num(p.Stock)}, min_stock = ${num(p.MinStock)}, vendor = COALESCE(NULLIF(${p.Vendor || ''}, ''), products.vendor), updated_at = NOW()`;
    return { success: true, id };
  },
  addCategory: async (body) => {
    const name = (body.categoryName || '').trim();
    if (!name) return { success: false, error: 'Category name is required' };
    await sql`CREATE TABLE IF NOT EXISTS categories (name TEXT PRIMARY KEY)`;
    await sql`INSERT INTO categories (name) VALUES (${name}) ON CONFLICT DO NOTHING`;
    return { success: true, categoryName: name };
  },
  postPurchase: async (body) => {
    const { billNo, supplier, items, user } = body;
    for (const item of (items || [])) {
      const qty = num(item.qty); const cost = num(item.cost);
      await sql`INSERT INTO purchase_transactions (date_time, bill_no, supplier, item_id, item_name, qty, cost, total, "user", status, updated_at) VALUES (NOW(), ${billNo}, ${supplier}, ${item.itemId}, ${item.itemName}, ${qty}, ${cost}, ${qty * cost}, ${user}, 'ACTIVE', NOW())`;
      await updateProductStock(item.itemId, qty, user, 'PURCHASE', billNo, '', 0, 0);
    }
    return { success: true };
  },
  adjustStock: async (body) => {
    await updateProductStock(body.itemId, body.qtyChange, body.user, 'ADJUSTMENT', 'ADJ-' + Date.now(), '', 0, 0);
    return { success: true };
  },
  updatePermissions: async (body) => {
    const perms = JSON.stringify(body.perms || {});
    await sql`INSERT INTO system_config (key, value) VALUES ('staff_perms', ${perms}) ON CONFLICT (key) DO UPDATE SET value = ${perms}`;
    return { success: true };
  },
  updateConfig: async (body) => {
    if (body.gst_rate !== undefined) {
      let gst = parseFloat(body.gst_rate); if (isNaN(gst)) gst = 0; if (gst > 1) gst = gst / 100;
      await sql`INSERT INTO system_config (key, value) VALUES ('gst_rate', ${String(gst)}) ON CONFLICT (key) DO UPDATE SET value = ${String(gst)}`;
    }
    if (body.bill_prefix !== undefined) {
      await sql`INSERT INTO system_config (key, value) VALUES ('bill_prefix', ${body.bill_prefix}) ON CONFLICT (key) DO UPDATE SET value = ${body.bill_prefix}`;
    }
    return { success: true };
  },
  clearCache: async () => ({ success: true }),
  // getProfitData can come via POST too
  getProfitData: async (p) => getHandlers.getProfitData(p),
};

/* ===================================================================
   ROUTE HANDLERS — mirror the Apps Script ?action= pattern
   The frontend does:
     GET  ${URL}?action=X&param1=Y
     POST ${URL}  body: { action: 'X', ...data }
   So we serve everything on a single path.
   =================================================================== */

// GET — action as query param
app.get('/api', async (req: Request, res: Response) => {
  const action = String(req.query.action || '');
  const handler = getHandlers[action];
  if (!handler) return res.status(400).json({ error: 'Invalid action', action });
  try { res.json(await handler(req.query as any)); }
  catch (e: any) { res.status(500).json({ error: String(e) }); }
});

// POST — action inside JSON body
app.post('/api', async (req: Request, res: Response) => {
  let body = req.body;
  // If the body came as a string (plain-text), try parsing as JSON
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const action = String(body.action || '');
  const handler = postHandlers[action];
  if (!handler) return res.status(400).json({ error: 'Invalid action', action });
  try { res.json(await handler(body)); }
  catch (e: any) { res.status(500).json({ error: String(e) }); }
});

/* ===== INTERNAL HELPERS ===== */

async function reverseBillLines(billNo: string, user: string) {
  const lines = await sql`SELECT * FROM sales_lines WHERE bill_no = ${billNo} AND status = 'ACTIVE'`;
  for (const ln of lines) {
    const qty = num(ln.qty);
    const lineType = String(ln.line_type || '').toUpperCase();
    const qtyChange = lineType === 'SALE' ? qty : -qty;
    await updateProductStock(ln.item_id, qtyChange, user, 'EDIT_REVERSAL', billNo, ln.line_id, num(ln.gst_rate), -num(ln.gst_amount));
  }
  await sql`UPDATE sales_lines SET status = 'REVERSED', updated_at = NOW() WHERE bill_no = ${billNo} AND status = 'ACTIVE'`;
}

async function updateProductStock(itemId: string, qtyChange: number, user: string, refType: string, refNo: string, refLineId: string, gstRate: number, gstAmount: number) {
  const rows = await sql`SELECT id, name, stock, cost FROM products WHERE id = ${itemId}`;
  if (!rows.length) return;
  const p = rows[0];
  const newStock = num(p.stock) + num(qtyChange);
  await sql`UPDATE products SET stock = ${newStock}, updated_at = NOW() WHERE id = ${itemId}`;
  await sql`INSERT INTO stock_ledger (id, date_time, ref_type, ref_no, ref_line_id, item_id, item_name, qty_change, cost, total, gst_rate, gst_amount, "user", notes) VALUES (${crypto.randomUUID()}, NOW(), ${refType}, ${refNo}, ${refLineId}, ${itemId}, ${p.name}, ${qtyChange}, ${num(p.cost)}, ${num(qtyChange) * num(p.cost)}, ${gstRate}, ${gstAmount}, ${user}, '')`;
}

/* Row mappers — convert snake_case DB columns to PascalCase matching frontend */
function toProduct(r: any) {
  return { ID: r.id, Name: r.name, Category: r.category, Unit: r.unit, Cost: num(r.cost), Selling: num(r.selling), Stock: num(r.stock), MinStock: num(r.min_stock), Vendor: r.vendor, UpdatedAt: r.updated_at };
}
function toBill(r: any) {
  return { BillNo: r.bill_no, DateTime: r.date_time, CustomerName: r.customer_name, CustomerContact: r.customer_contact, Method: r.method, TransferId: r.transfer_id, User: r.user, Subtotal: num(r.subtotal), GSTTotal: num(r.gst_total), GrandTotal: num(r.grand_total), Status: r.status, UpdatedAt: r.updated_at };
}
function toLine(r: any) {
  return { BillNo: r.bill_no, LineId: r.line_id, DateTime: r.date_time, ItemID: r.item_id, ItemName: r.item_name, Qty: num(r.qty), Rate: num(r.rate), UnitCost: num(r.unit_cost), LineType: r.line_type, GST_Rate: num(r.gst_rate), GST_Amount: num(r.gst_amount), LineTotal: num(r.line_total), User: r.user, Status: r.status, UpdatedAt: r.updated_at };
}

/* ===== START ===== */
app.listen(PORT, () => {
  console.log(`✅ Samten API server running on http://localhost:${PORT}`);
  console.log(`   Frontend should use: const WEB_APP_URL = 'http://localhost:${PORT}/api';`);
});
