/**
 * Samten Inventory System - Google Apps Script Backend
 * Optimized for faster data fetching and fewer Spreadsheet service calls
 * Logic preserved from original version
 */

if (typeof SS === 'undefined') {
  var SS = SpreadsheetApp.getActiveSpreadsheet();
}

const SHEET_NAMES = {
  PRODUCTS: 'Products',
  CONFIG: 'System_Config',
  SALES_BILLS: 'Sales_Bills',
  SALES_LINES: 'Sales_Lines',
  PURCHASES: 'Purchase_Transactions',
  LEDGER: 'Stock_Ledger',
  USERS: 'Users'
};

// Per-execution cache
const _sheetCache = {};
const _dataCache = {};
const _headerCache = {};

function doGet(e) {
  const action = e.parameter.action;
  try {
    switch (action) {
      case 'getConfig':
        return jsonResponse(getConfig());
      case 'listProducts':
        return jsonResponse(listProducts(e.parameter.q, e.parameter.limit, e.parameter.start));
      case 'getBill':
        return jsonResponse(getBill(e.parameter.billNo));
      case 'listCategories':
        return jsonResponse(listCategories());
      case 'listBills':
        return jsonResponse(listBills(e.parameter));
      case 'getProduct':
        return jsonResponse(getProductById(e.parameter.productId));
      case 'debugBills':
        return jsonResponse(listBillsDebug(e.parameter.limit || 20));
      case 'getDashboardData':
        return jsonResponse(getDashboardData());
      case 'getProfitData':
        return jsonResponse(getProfitData({ startMonth: e.parameter.startMonth, endMonth: e.parameter.endMonth }));
      case 'login':
        return jsonResponse(login(e.parameter.username, e.parameter.password));
      default:
        return jsonResponse({ error: 'Invalid action' }, 400);
    }
  } catch (err) {
    return jsonResponse({ error: err.toString() }, 500);
  }
}

function doPost(e) {
  // Robust POST body parsing: accept JSON or form-encoded bodies and
  // provide clearer error messages. e.postData.type may be undefined in
  // some hosting/configurations, so fall back safely.
  let body = {};
  try {
    const raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
    const contentType = e && e.postData && e.postData.type ? String(e.postData.type).toLowerCase() : '';

    if (contentType.indexOf('application/json') !== -1) {
      body = JSON.parse(raw || '{}');
    } else if (contentType.indexOf('application/x-www-form-urlencoded') !== -1 || (raw && raw.indexOf('=') !== -1)) {
      // parse form-encoded body into an object
      const params = {};
      raw.split('&').forEach(pair => {
        const idx = pair.indexOf('=');
        if (idx > -1) {
          const k = decodeURIComponent(pair.substring(0, idx));
          const v = decodeURIComponent(pair.substring(idx + 1));
          params[k] = v;
        }
      });
      body = params;
    } else if (raw) {
      // try JSON parse as a last resort
      try { body = JSON.parse(raw); } catch (err) { body = {}; }
    }
  } catch (err) {
    return jsonResponse({ error: 'Bad POST body: ' + String(err) }, 400);
  }

  const action = body.action;
  const lock = LockService.getScriptLock();

  try {
    if (lock.tryLock(10000)) {
      switch (action) {
        case 'createBill':
          return jsonResponse(createBill(body));
        case 'saveBill':
          return jsonResponse(saveBill(body));
        case 'reopenBill':
          return jsonResponse(reopenBill(body));
        case 'postPurchase':
          return jsonResponse(postPurchase(body));
        case 'adjustStock':
          return jsonResponse(adjustStock(body));
        case 'addCategory':
          return jsonResponse(addCategory(body));
        case 'saveProduct':
          return jsonResponse(saveProduct(body));
        case 'updatePermissions':
          return jsonResponse(updatePermissions(body));
        case 'updateConfig':
          return jsonResponse(updateConfig(body));
        
        case 'getProfitData':
          return jsonResponse(getProfitData({ startMonth: body.startMonth, endMonth: body.endMonth }));
        case 'clearCache':
          return jsonResponse(clearCaches(body));
        default:
          return jsonResponse({ error: 'Invalid action' }, 400);
      }
    } else {
      return jsonResponse({ error: 'Lock timeout' }, 408);
    }
  } catch (err) {
    return jsonResponse({ error: err.toString() }, 500);
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

function jsonResponse(data, status = 200) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// Simple script-wide cache helper using CacheService
function getScriptCache() {
  try {
    return CacheService.getScriptCache();
  } catch (e) {
    return null;
  }
}

// ------------------------------
// Core helpers
// ------------------------------

function getSheet(sheetName) {
  if (!_sheetCache[sheetName]) {
    _sheetCache[sheetName] = SS.getSheetByName(sheetName);
  }
  return _sheetCache[sheetName];
}

function getLastDataRow(sheet) {
  return sheet ? sheet.getLastRow() : 0;
}

function getLastDataCol(sheet) {
  return sheet ? sheet.getLastColumn() : 0;
}

function getHeaders(sheetName) {
  if (_headerCache[sheetName]) return _headerCache[sheetName];
  const sheet = getSheet(sheetName);
  if (!sheet) return [];
  const lastCol = getLastDataCol(sheet);
  if (lastCol === 0) return [];
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  _headerCache[sheetName] = headers;
  return headers;
}

function getSheetValues(sheetName) {
  if (_dataCache[sheetName]) return _dataCache[sheetName];
  const sheet = getSheet(sheetName);
  if (!sheet) return [];
  const lastRow = getLastDataRow(sheet);
  const lastCol = getLastDataCol(sheet);
  if (lastRow < 1 || lastCol < 1) return [];
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  _dataCache[sheetName] = values;
  return values;
}

function getColumnValues(sheetName, colIndex) {
  const sheet = getSheet(sheetName);
  if (!sheet) return [];
  const lastRow = getLastDataRow(sheet);
  if (lastRow < 2) return [];
  return sheet.getRange(2, colIndex, lastRow - 1, 1).getValues().map(r => r[0]);
}

function getSheetData(sheetName) {
  const values = getSheetValues(sheetName);
  if (!values.length) return [];
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function clearExecutionCache(sheetName) {
  if (sheetName) {
    delete _dataCache[sheetName];
    delete _headerCache[sheetName];
  } else {
    Object.keys(_dataCache).forEach(k => delete _dataCache[k]);
    Object.keys(_headerCache).forEach(k => delete _headerCache[k]);
  }
}

function getTZ() {
  return SS.getSpreadsheetTimeZone ? SS.getSpreadsheetTimeZone() : Session.getScriptTimeZone();
}

// ------------------------------
// Config / master data
// ------------------------------

function getConfig() {
  // Cache config in script cache for short periods to reduce sheet reads
  const cache = getScriptCache();
  const cacheKey = 'config_cache_v1';
  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* fall through */ }
    }
  }

  const data = getSheetData(SHEET_NAMES.CONFIG);
  const config = {};
  data.forEach(row => {
    if (row.Key === 'staff_perms') {
      try { config[row.Key] = JSON.parse(row.Value); } catch (e) { config[row.Key] = {}; }
    } else if (['gst_rate', 'bill_no_seed'].includes(row.Key)) {
      config[row.Key] = parseFloat(row.Value);
    } else {
      config[row.Key] = row.Value;
    }
  });

  if (cache) {
    try { cache.put(cacheKey, JSON.stringify(config), 300); } catch (e) {}
  }
  return config;
}

function listProducts(q = '', limit = 100, start = 0) {
  // Support pagination and minimal column reads for performance
  limit = parseInt(limit, 10) || 100;
  start = parseInt(start, 10) || 0;
  const lowerQ = q ? String(q).toLowerCase() : null;

  const sheet = getSheet(SHEET_NAMES.PRODUCTS);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // If query provided, read only ID, Name, Category columns for all rows and filter
  if (lowerQ) {
    // Columns: ID(1), Name(2), Category(3), Selling(6), Stock(7), MinStock(8), Unit(4), Vendor(9), UpdatedAt(10)
    const values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
    const results = [];
    for (let i = 0; i < values.length; i++) {
      const r = values[i];
      const id = String(r[0] || '');
      const name = String(r[1] || '');
      const cat = String(r[2] || '');
      if (id.toLowerCase().includes(lowerQ) || name.toLowerCase().includes(lowerQ) || cat.toLowerCase().includes(lowerQ)) {
        results.push({
          ID: id,
          Name: name,
          Category: cat,
          Unit: r[3],
          Cost: r[4],
          Selling: r[5],
          Stock: r[6],
          MinStock: r[7],
          Vendor: r[8],
          UpdatedAt: r[9]
        });
        if (results.length >= limit) break;
      }
    }
    return results;
  }

  // No query: use pagination to read only requested range (start is zero-based offset)
  const readLimit = limit;
  const available = lastRow - 1;
  if (start >= available) return [];
  const readStartRow = 2 + start; // row in sheet to start reading
  const toRead = Math.min(readLimit, available - start);
  if (toRead <= 0) return [];
  const values = sheet.getRange(readStartRow, 1, toRead, 10).getValues();
  return values.map(r => ({
    ID: r[0], Name: r[1], Category: r[2], Unit: r[3], Cost: r[4], Selling: r[5], Stock: r[6], MinStock: r[7], Vendor: r[8], UpdatedAt: r[9]
  }));
}

function listCategories() {
  const products = getSheetData(SHEET_NAMES.PRODUCTS);
  const seen = {};
  const categories = [];
  for (let i = 0; i < products.length; i++) {
    const cat = products[i].Category;
    if (cat && !seen[cat]) {
      seen[cat] = true;
      categories.push(cat);
    }
  }
  return categories;
}

// ------------------------------
// Bills
// ------------------------------

function listBills(params) {
  params = params || {};
  const limit = params.limit ? parseInt(params.limit, 10) : 100;
  // 'offset' is used for pagination (number of items to skip). Backwards
  // compatibility: if callers provided a numeric 'start' we don't treat it as
  // an offset when it's a date string. Prefer explicit 'offset' param.
  const offset = params.offset ? parseInt(params.offset, 10) : 0;
  const start = params.start ? new Date(params.start) : null;
  const end = params.end ? new Date(params.end) : null;
  const billNo = params.billNo ? String(params.billNo).toLowerCase() : null;

  const sheet = getSheet(SHEET_NAMES.SALES_BILLS);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const tz = getTZ();

  // If no filters provided, read only the most recent rows. If an offset is
  // requested, read enough rows to satisfy offset+limit; otherwise read up
  // to `limit` rows. When filters are present we must read all rows to
  // filter server-side.
  const noFilters = !params.start && !params.end && !params.billNo;
  let values = [];
  if (noFilters) {
    const needed = offset ? Math.min(Math.max(0, lastRow - 1), offset + limit) : Math.min(Math.max(0, lastRow - 1), limit);
    const startRow = Math.max(2, lastRow - needed + 1);
    values = sheet.getRange(startRow, 1, needed, 10).getValues();
  } else {
    // Read all and filter server-side (filters present)
    values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  }

  let endTs = null;
  if (end) {
    endTs = new Date(end);
    if (endTs.getHours() === 0 && endTs.getMinutes() === 0 && endTs.getSeconds() === 0) {
      endTs.setHours(23, 59, 59, 999);
    }
    endTs = endTs.getTime();
  }

  const startStr = params.start ? String(params.start) : null;
  const endStr = params.end ? String(params.end) : null;

  const results = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const billNoVal = row[0] || '';
    const dateVal = row[1];
    const dt = dateVal instanceof Date ? dateVal : new Date(dateVal);
    const ts = isNaN(dt) ? null : dt.getTime();
    const rowDateStr = ts ? Utilities.formatDate(new Date(ts), tz, 'yyyy-MM-dd') : null;

  if (billNo && !String(billNoVal).toLowerCase().includes(billNo)) continue;
    if ((startStr || endStr) && !rowDateStr) continue;
    if (startStr && rowDateStr < startStr) continue;
    if (endStr && rowDateStr > endStr) continue;

    results.push({
      BillNo: billNoVal,
      DateTime: dt,
      CustomerName: row[2],
      Method: row[3],
      User: row[4],
      Subtotal: row[5],
      GSTTotal: row[6],
      GrandTotal: row[7],
      Status: row[8],
      UpdatedAt: row[9]
    });
  }

  results.sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime));

  // Apply pagination offset and limit. If offset is 0 this behaves like the
  // previous implementation (return up to `limit` most recent rows).
  const startIndex = Math.max(0, offset || 0);
  const endIndex = Math.min(results.length, startIndex + limit);
  return results.slice(startIndex, endIndex);
}

function listBillsDebug(limit = 20) {
  const sheet = getSheet(SHEET_NAMES.SALES_BILLS);
  if (!sheet) return { error: 'Sales_Bills sheet not found' };

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1) return { headers: [], rows: [] };

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const readCount = Math.min(Math.max(0, lastRow - 1), parseInt(limit, 10));
  const rows = readCount > 0 ? sheet.getRange(2, 1, readCount, lastCol).getValues() : [];

  return { lastRow, lastCol, headers, rows };
}

function getBill(billNo) {
  const bills = getSheetData(SHEET_NAMES.SALES_BILLS);
  const bill = bills.find(b => b.BillNo === billNo);
  if (!bill) return null;

  const lines = getSheetData(SHEET_NAMES.SALES_LINES);
  const billLines = lines.filter(l => l.BillNo === billNo && l.Status === 'ACTIVE');

  return { ...bill, lines: billLines };
}

// Fast single-product lookup using ID column index + row read to avoid scanning full sheet
function getProductById(id) {
  const sheet = getSheet(SHEET_NAMES.PRODUCTS);
  if (!sheet) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  // Read ID column only and build a row index map (cached)
  const cache = getScriptCache();
  const idxKey = 'product_index_v1';
  let indexMap = null;
  if (cache) {
    try { indexMap = JSON.parse(cache.get(idxKey) || 'null'); } catch (e) { indexMap = null; }
  }

  if (!indexMap) {
    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    indexMap = {};
    for (let i = 0; i < ids.length; i++) {
      const val = ids[i][0];
      if (val !== undefined && val !== null && String(val) !== '') indexMap[String(val)] = i + 2; // sheet row
    }
    if (cache) {
      try { cache.put(idxKey, JSON.stringify(indexMap), 300); } catch (e) {}
    }
  }

  const row = indexMap[String(id)];
  if (!row) return null;
  const lastCol = getLastDataCol(sheet);
  const values = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  const headers = getHeaders(SHEET_NAMES.PRODUCTS);
  const obj = {};
  headers.forEach((h, i) => obj[h] = values[i]);
  return obj;
}

// Clear caches: supports body.keys array or clears known keys
function clearCaches(body) {
  // Clear in-memory execution caches
  clearExecutionCache();

  const cache = getScriptCache();
  if (!cache) return { success: true };

  if (body && Array.isArray(body.keys)) {
    body.keys.forEach(k => {
      try { cache.remove(k); } catch (e) {}
    });
    return { success: true, removed: body.keys };
  }

  // Remove common keys
  const keys = ['config_cache_v1', 'product_index_v1'];
  keys.forEach(k => { try { cache.remove(k); } catch (e) {} });
  return { success: true, removed: keys };
}

function createBill(body) {
  const config = getConfig();
  const billNo = config.bill_prefix + config.bill_no_seed;

  const sheet = getSheet(SHEET_NAMES.CONFIG);
  const data = getSheetValues(SHEET_NAMES.CONFIG);

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'bill_no_seed') {
      sheet.getRange(i + 1, 2).setValue(config.bill_no_seed + 1);
      clearExecutionCache(SHEET_NAMES.CONFIG);
      break;
    }
  }

  return { billNo };
}

function saveBill(body) {
  const { billNo, customerName, method, user, lines } = body;
  const now = new Date();

  const billsSheet = getSheet(SHEET_NAMES.SALES_BILLS);
  const billsData = getSheetValues(SHEET_NAMES.SALES_BILLS);

  let billRowIndex = -1;
  for (let i = 1; i < billsData.length; i++) {
    if (billsData[i][0] === billNo) {
      billRowIndex = i + 1;
      break;
    }
  }

  // If this is an edit of an existing bill, check whether it's locked.
  if (billRowIndex !== -1) {
    const existingRow = billsData[billRowIndex - 1] || [];
    const existingStatus = existingRow[8]; // Status column in sheet
    if (String(existingStatus).toUpperCase() === 'LOCKED' && !body.force) {
      return { success: false, error: 'Bill is locked and cannot be edited' };
    }
    // Reverse previous lines (stock adjustments) before applying new ones
    reverseBillLines(billNo, user);
  }

  let subtotal = 0;
  let gstTotal = 0;

  const linesSheet = getSheet(SHEET_NAMES.SALES_LINES);

  // Batch line inserts
  const lineRows = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const lineId = Utilities.getUuid();
    const lineTotal = line.qty * line.rate;
    const gstAmount = lineTotal * line.gstRate;

    subtotal += lineTotal;
    gstTotal += gstAmount;

    lineRows.push([
      billNo, lineId, now, line.itemId, line.itemName, line.qty, line.rate, line.lineType,
      line.gstRate, gstAmount, lineTotal, user, 'ACTIVE', now
    ]);

    const qtyChange = line.lineType === 'SALE' ? -line.qty : line.qty;
    updateProductStock(line.itemId, qtyChange, user, 'SALE', billNo, lineId, line.gstRate, gstAmount);
  }

  if (lineRows.length) {
    const startRow = linesSheet.getLastRow() + 1;
    linesSheet.getRange(startRow, 1, lineRows.length, lineRows[0].length).setValues(lineRows);
    clearExecutionCache(SHEET_NAMES.SALES_LINES);
  }

  const grandTotal = subtotal + gstTotal;

  if (billRowIndex !== -1) {
    const newStatus = body.lock ? 'LOCKED' : 'ACTIVE';
    billsSheet.getRange(billRowIndex, 3, 1, 8).setValues([[
      customerName, method, user, subtotal, gstTotal, grandTotal, newStatus, now
    ]]);
  } else {
    const newStatus = body.lock ? 'LOCKED' : 'ACTIVE';
    billsSheet.appendRow([
      billNo, now, customerName, method, user, subtotal, gstTotal, grandTotal, newStatus, now
    ]);
  }

  clearExecutionCache(SHEET_NAMES.SALES_BILLS);

  return { success: true, billNo };
}

function reverseBillLines(billNo, user) {
  const linesSheet = getSheet(SHEET_NAMES.SALES_LINES);
  const linesData = getSheetValues(SHEET_NAMES.SALES_LINES);
  const now = new Date();

  const statusUpdates = [];
  const updatedRows = [];

  for (let i = 1; i < linesData.length; i++) {
    if (linesData[i][0] === billNo && linesData[i][12] === 'ACTIVE') {
      const line = {
        billNo: linesData[i][0],
        lineId: linesData[i][1],
        itemId: linesData[i][3],
        qty: linesData[i][5],
        lineType: linesData[i][7],
        gstRate: linesData[i][8],
        gstAmount: linesData[i][9]
      };

      updatedRows.push(i + 1);

      const qtyChange = line.lineType === 'SALE' ? line.qty : -line.qty;
      updateProductStock(line.itemId, qtyChange, user, 'EDIT_REVERSAL', billNo, line.lineId, line.gstRate, -line.gstAmount);
    }
  }

  // Keep same logic, but write statuses in batch when possible
  for (let j = 0; j < updatedRows.length; j++) {
    statusUpdates.push(['REVERSED', now]);
  }

  if (updatedRows.length) {
    for (let k = 0; k < updatedRows.length; k++) {
      linesSheet.getRange(updatedRows[k], 13, 1, 2).setValues([[statusUpdates[k][0], statusUpdates[k][1]]]);
    }
    clearExecutionCache(SHEET_NAMES.SALES_LINES);
  }
}

// ------------------------------
// Stock / product operations
// ------------------------------

function updateProductStock(itemId, qtyChange, user, refType, refNo, refLineId, gstRate, gstAmount) {
  const productsSheet = getSheet(SHEET_NAMES.PRODUCTS);
  const ledgerSheet = getSheet(SHEET_NAMES.LEDGER);
  const productsData = getSheetValues(SHEET_NAMES.PRODUCTS);
  const now = new Date();

  for (let i = 1; i < productsData.length; i++) {
    if (String(productsData[i][0]) === String(itemId)) {
      const currentStock = parseFloat(productsData[i][6]) || 0;
      const newStock = currentStock + qtyChange;
      const cost = parseFloat(productsData[i][4]) || 0;

      productsSheet.getRange(i + 1, 7).setValue(newStock);
      productsSheet.getRange(i + 1, 10).setValue(now);

      ledgerSheet.appendRow([
        Utilities.getUuid(), now, refType, refNo, refLineId, itemId, productsData[i][1],
        qtyChange, cost, qtyChange * cost, gstRate, gstAmount, user, ''
      ]);

      clearExecutionCache(SHEET_NAMES.PRODUCTS);
      clearExecutionCache(SHEET_NAMES.LEDGER);
      try { const cache = getScriptCache(); if (cache) cache.remove('product_index_v1'); } catch (e) {}
      break;
    }
  }
}

function saveProduct(body) {
  const { product } = body;
  const sheet = getSheet(SHEET_NAMES.PRODUCTS);
  const data = getSheetValues(SHEET_NAMES.PRODUCTS);
  const now = new Date();

  let rowIndex = -1;
  let id = product.ID;

  if (id) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(id)) {
        rowIndex = i + 1;
        break;
      }
    }
  } else {
    id = getNextProductId();
  }

  const rowData = [
    id,
    product.Name,
    product.Category,
    product.Unit,
    product.Cost,
    product.Selling,
    product.Stock || 0,
    product.MinStock,
    product.Vendor,
    now
  ];

  if (rowIndex !== -1) {
    sheet.getRange(rowIndex, 1, 1, 10).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  clearExecutionCache(SHEET_NAMES.PRODUCTS);
  // Invalidate product index cache
  try { const cache = getScriptCache(); if (cache) cache.remove('product_index_v1'); } catch (e) {}
  return { success: true, id };
}

function addCategory(body) {
  return { success: true };
}

function postPurchase(body) {
  const { billNo, supplier, items, user } = body;
  const now = new Date();
  const purchaseSheet = getSheet(SHEET_NAMES.PURCHASES);

  const purchaseRows = [];

  items.forEach(item => {
    const total = item.qty * item.cost;
    purchaseRows.push([
      now, billNo, supplier, item.itemId, item.itemName, item.qty, item.cost, total, user, 'ACTIVE', now
    ]);

    updateProductStock(item.itemId, item.qty, user, 'PURCHASE', billNo, '', 0, 0);
  });

  if (purchaseRows.length) {
    const startRow = purchaseSheet.getLastRow() + 1;
    purchaseSheet.getRange(startRow, 1, purchaseRows.length, purchaseRows[0].length).setValues(purchaseRows);
    clearExecutionCache(SHEET_NAMES.PURCHASES);
  }

  // Product stock changed; invalidate index cache
  try { const cache = getScriptCache(); if (cache) cache.remove('product_index_v1'); } catch (e) {}

  return { success: true };
}

function adjustStock(body) {
  const { itemId, qtyChange, notes, user } = body;
  updateProductStock(itemId, qtyChange, user, 'ADJUSTMENT', 'ADJ-' + Date.now(), '', 0, 0);
  try { const cache = getScriptCache(); if (cache) cache.remove('product_index_v1'); } catch (e) {}
  return { success: true };
}

function getNextProductId() {
  const configSheet = getSheet(SHEET_NAMES.CONFIG);
  const data = getSheetValues(SHEET_NAMES.CONFIG);

  let seed = 1;
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'product_id_seed') {
      seed = parseInt(data[i][1], 10);
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    configSheet.appendRow(['product_id_seed', 2]);
  } else {
    configSheet.getRange(rowIndex, 2).setValue(seed + 1);
  }

  clearExecutionCache(SHEET_NAMES.CONFIG);
  return 'A' + seed.toString().padStart(3, '0');
}

// ------------------------------
// Auth / permissions / config
// ------------------------------

function login(username, password) {
  if (username === 'admin' && password === 'admin123') {
    return { success: true, user: { username: 'admin', role: 'ADMIN' } };
  }

  const users = getSheetData(SHEET_NAMES.USERS);
  const user = users.find(u => u.Username === username && u.Password === password);

  if (user) {
    return { success: true, user: { username: user.Username, role: user.Role } };
  }

  return { success: false, error: 'Invalid credentials' };
}

function updatePermissions(body) {
  const { perms } = body;
  const sheet = getSheet(SHEET_NAMES.CONFIG);
  const data = getSheetValues(SHEET_NAMES.CONFIG);

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'staff_perms') {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(perms));
      clearExecutionCache(SHEET_NAMES.CONFIG);
      return { success: true };
    }
  }

  sheet.appendRow(['staff_perms', JSON.stringify(perms)]);
  clearExecutionCache(SHEET_NAMES.CONFIG);
  try { const cache = getScriptCache(); if (cache) cache.remove('config_cache_v1'); } catch (e) {}
  return { success: true };
}

function updateConfig(body) {
  const sheet = getSheet(SHEET_NAMES.CONFIG);
  const data = getSheetValues(SHEET_NAMES.CONFIG);

  const keysToUpdate = {};

  if (body.gst_rate !== undefined && body.gst_rate !== null) {
    let gst = parseFloat(body.gst_rate);
    if (isNaN(gst)) gst = 0;
    if (gst > 1) gst = gst / 100;
    keysToUpdate['gst_rate'] = gst;
  }

  if (body.bill_prefix !== undefined && body.bill_prefix !== null) {
    keysToUpdate['bill_prefix'] = String(body.bill_prefix);
  }

  const lowerKeys = Object.keys(keysToUpdate);

  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    if (!key) continue;
    if (lowerKeys.includes(key)) {
      sheet.getRange(i + 1, 2).setValue(keysToUpdate[key]);
    }
  }

  for (let k = 0; k < lowerKeys.length; k++) {
    const key = lowerKeys[k];
    const exists = data.some(r => r[0] === key);
    if (!exists) {
      sheet.appendRow([key, keysToUpdate[key]]);
    }
  }

  clearExecutionCache(SHEET_NAMES.CONFIG);
  try { const cache = getScriptCache(); if (cache) cache.remove('config_cache_v1'); } catch (e) {}
  return { success: true, updated: keysToUpdate };
}

// ------------------------------
// Dashboard
// ------------------------------

function getDashboardData() {
  const products = getSheetData(SHEET_NAMES.PRODUCTS);
  const lines = getSheetData(SHEET_NAMES.SALES_LINES);
  const bills = getSheetData(SHEET_NAMES.SALES_BILLS);

  const lowStock = products.filter(p => Number(p.Stock) <= Number(p.MinStock));

  // Build product map once for faster category lookup
  const productMap = {};
  for (let i = 0; i < products.length; i++) {
    productMap[String(products[i].ID)] = products[i];
  }

  // Sales by category (existing behavior)
  const salesByCategory = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.Status === 'ACTIVE' && (line.LineType === 'SALE' || String(line.LineType).toUpperCase() === 'SALE')) {
      const product = productMap[String(line.ItemID)];
      const category = product ? product.Category : 'Unknown';
      salesByCategory[category] = (salesByCategory[category] || 0) + Number(line.LineTotal || 0);
    }
  }

  const chartData = Object.keys(salesByCategory).map(cat => ({ name: cat, value: salesByCategory[cat] }));

  // Summary metrics and aggregations for dashboard
  let totalSales = 0;
  let totalTransactions = 0;
  let totalItemsSold = 0;

  // Payment method totals (sum of GrandTotal per method)
  const paymentTotals = {};

  // Monthly sales aggregation (keyed by yyyy-MM)
  const monthlyMap = {};

  for (let i = 0; i < bills.length; i++) {
    const b = bills[i];
    const status = b.Status || '';
    // treat only ACTIVE bills as completed sales
    if (String(status).toUpperCase() !== 'ACTIVE') continue;

    const grand = Number(b.GrandTotal || 0) || 0;
    totalSales += grand;
    totalTransactions += 1;

    const method = b.Method || 'UNKNOWN';
    paymentTotals[method] = (paymentTotals[method] || 0) + grand;

    // month key
    const dt = b.DateTime ? new Date(b.DateTime) : null;
    if (dt && !isNaN(dt.getTime())) {
      const key = Utilities.formatDate(dt, getTZ(), 'yyyy-MM');
      monthlyMap[key] = (monthlyMap[key] || 0) + grand;
    }
  }

  // Sum items sold from sales lines (only SALE lines, ACTIVE)
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.Status === 'ACTIVE' && (ln.LineType === 'SALE' || String(ln.LineType).toUpperCase() === 'SALE')) {
      totalItemsSold += Number(ln.Qty || 0) || 0;
    }
  }

  // Build monthly array sorted by month
  const monthlyKeys = Object.keys(monthlyMap).sort();
  const monthlySales = monthlyKeys.map(k => {
    // Format label like 'Jan 2026'
    const parts = k.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const label = Utilities.formatDate(new Date(year, month, 1), getTZ(), 'MMM yyyy');
    return { month: k, name: label, value: monthlyMap[k] };
  });

  // Payment methods array for pie chart
  const paymentMethods = Object.keys(paymentTotals).map(m => ({ name: String(m), value: paymentTotals[m] }));

  return {
    lowStock,
    chartData,
    monthlySales,
    paymentMethods,
    totalSales,
    totalTransactions,
    totalItemsSold
  };
}

// ------------------------------
// Profitability
// ------------------------------

// Simplified profit data: return only revenue and COGS (cost of goods sold).
// This avoids scanning purchases/expenses sheets as requested.
function getProfitData(params) {
  // Read sheets once
  const products = getSheetData(SHEET_NAMES.PRODUCTS);
  const bills = getSheetData(SHEET_NAMES.SALES_BILLS);
  const lines = getSheetData(SHEET_NAMES.SALES_LINES);

  // Build product cost map for fast lookup
  const productCost = {};
  for (let i = 0; i < products.length; i++) {
    const id = String(products[i].ID);
    productCost[id] = Number(products[i].Cost || 0) || 0;
  }

  const tz = getTZ();

  // Map billNo -> monthKey (yyyy-MM) and aggregate revenue per month
  const billMonth = {};
  const monthlyRevenue = {};
  let totalRevenue = 0;

  for (let i = 0; i < bills.length; i++) {
    const b = bills[i];
    if (String(b.Status || '').toUpperCase() !== 'ACTIVE') continue;
    const billNo = String(b.BillNo || '');
    const dt = b.DateTime ? new Date(b.DateTime) : null;
    const monthKey = dt && !isNaN(dt.getTime()) ? Utilities.formatDate(dt, tz, 'yyyy-MM') : 'unknown';
    // If params provided, filter bills outside the requested month range
    if (params && (params.startMonth || params.endMonth)) {
      const startM = params.startMonth || null;
      const endM = params.endMonth || null;
      if (monthKey === 'unknown') continue;
      if (startM && monthKey < startM) continue;
      if (endM && monthKey > endM) continue;
    }
    billMonth[billNo] = monthKey;
    const grand = Number(b.GrandTotal || 0) || 0;
    monthlyRevenue[monthKey] = (monthlyRevenue[monthKey] || 0) + grand;
    totalRevenue += grand;
  }

  // Aggregate COGS per month by mapping each SALE line to its bill's month
  const monthlyCogs = {};
  let totalCogs = 0;

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (String(ln.Status || '').toUpperCase() !== 'ACTIVE') continue;
    const lineType = String(ln.LineType || ln.LineType || '').toUpperCase();
    if (lineType !== 'SALE') continue;
    const billNo = String(ln.BillNo || '');
    let monthKey = billMonth[billNo] || (ln.DateTime ? Utilities.formatDate(new Date(ln.DateTime), tz, 'yyyy-MM') : 'unknown');
    // If billMonth mapping not present, and params provided, derive monthKey and filter
    if (params && (params.startMonth || params.endMonth) && monthKey !== 'unknown') {
      const startM = params.startMonth || null;
      const endM = params.endMonth || null;
      if (startM && monthKey < startM) continue;
      if (endM && monthKey > endM) continue;
    }
    const qty = Number(ln.Qty || ln.qty || 0) || 0;
    const costPer = productCost[String(ln.ItemID)] || 0;
    const lineCost = qty * costPer;
    monthlyCogs[monthKey] = (monthlyCogs[monthKey] || 0) + lineCost;
    totalCogs += lineCost;
  }

  // Build sorted monthlyProfit array (include months appearing in revenue or cogs)
  const monthKeysSet = {};
  Object.keys(monthlyRevenue).forEach(k => monthKeysSet[k] = true);
  Object.keys(monthlyCogs).forEach(k => monthKeysSet[k] = true);
  const monthKeys = Object.keys(monthKeysSet).filter(k => k !== 'unknown').sort();

  const monthlyProfit = monthKeys.map(k => {
    const rev = monthlyRevenue[k] || 0;
    const cost = monthlyCogs[k] || 0;
    const profit = rev - cost;
    const parts = k.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const name = Utilities.formatDate(new Date(year, month, 1), tz, 'MMM yyyy');
    return { month: k, name, profit };
  });

  return { totalRevenue, cogs: totalCogs, monthlyProfit };
}

// Reopen (unlock) a bill so it becomes editable again. This only flips the
// Status column back to ACTIVE and updates the timestamp. Caller should be
// an admin or a deliberate user action.
function reopenBill(body) {
  const billNo = body && body.billNo ? String(body.billNo) : null;
  if (!billNo) return { success: false, error: 'billNo required' };

  const sheet = getSheet(SHEET_NAMES.SALES_BILLS);
  if (!sheet) return { success: false, error: 'Sales_Bills sheet not found' };
  const data = getSheetValues(SHEET_NAMES.SALES_BILLS);

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === billNo) {
      // Status is column 9, UpdatedAt column 10
      sheet.getRange(i + 1, 9).setValue('ACTIVE');
      sheet.getRange(i + 1, 10).setValue(new Date());
      clearExecutionCache(SHEET_NAMES.SALES_BILLS);
      return { success: true, billNo };
    }
  }

  return { success: false, error: 'Bill not found' };
}