/**
 * Samten Inventory System - Google Apps Script Backend
 * Corrected + optimized version
 *
 * Main fixes:
 * - Header-aware mapping for Sales_Bills / Sales_Lines / Products
 * - Correct reopenBill() updates Status + UpdatedAt columns by header name
 * - Correct locked-bill check in saveBill()
 * - Safe numeric normalization to prevent corrupted totals
 * - Dashboard totalSales excludes invalid / corrupted values
 * - Support for CustomerContact + TransferId in current sheet layout
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

const _sheetCache = {};
const _dataCache = {};
const _headerCache = {};

/* =========================
   ENTRY POINTS
========================= */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : '';
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
        return jsonResponse(listBills(e.parameter || {}));
      case 'debugBillRow':
        return jsonResponse(debugBillRow(e.parameter.billNo));
      case 'ensureBillHeaders':
        return jsonResponse(ensureBillHeaders());
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
      case 'ping':
        return jsonResponse({ success: true, message: 'pong' });
      default:
        return jsonResponse({ error: 'Invalid action', action: action }, 400);
    }
  } catch (err) {
    return jsonResponse({
      error: String(err),
      stack: err && err.stack ? String(err.stack) : ''
    }, 500);
  }
}

function doPost(e) {
  let body = {};
  try {
    const raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : '';
    const contentType = e && e.postData && e.postData.type ? String(e.postData.type).toLowerCase() : '';

    if (contentType.indexOf('application/json') !== -1) {
      body = JSON.parse(raw || '{}');
    } else if (contentType.indexOf('application/x-www-form-urlencoded') !== -1 || (raw && raw.indexOf('=') !== -1)) {
      const params = {};
      raw.split('&').forEach(function (pair) {
        const idx = pair.indexOf('=');
        if (idx > -1) {
          const k = decodeURIComponent(pair.substring(0, idx));
          const v = decodeURIComponent(pair.substring(idx + 1));
          params[k] = v;
        }
      });
      body = params;
    } else if (raw) {
      try { body = JSON.parse(raw); } catch (_) { body = {}; }
    }
  } catch (err) {
    return jsonResponse({ error: 'Bad POST body: ' + String(err) }, 400);
  }

  const action = body.action;
  const lock = LockService.getScriptLock();

  try {
    if (!lock.tryLock(10000)) {
      return jsonResponse({ error: 'Lock timeout' }, 408);
    }

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
        return jsonResponse({ error: 'Invalid action', action: action }, 400);
    }
  } catch (err) {
    return jsonResponse({
      error: String(err),
      stack: err && err.stack ? String(err.stack) : ''
    }, 500);
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function jsonResponse(data, status) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =========================
   HELPERS
========================= */

function getScriptCache() {
  try { return CacheService.getScriptCache(); } catch (_) { return null; }
}

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

function clearExecutionCache(sheetName) {
  if (sheetName) {
    delete _dataCache[sheetName];
    delete _headerCache[sheetName];
  } else {
    Object.keys(_dataCache).forEach(function (k) { delete _dataCache[k]; });
    Object.keys(_headerCache).forEach(function (k) { delete _headerCache[k]; });
  }
}

function getTZ() {
  return SS.getSpreadsheetTimeZone ? SS.getSpreadsheetTimeZone() : Session.getScriptTimeZone();
}

function normalizeKey(key) {
  return String(key || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function toNumberSafe(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (value instanceof Date) return 0;
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

function toTextSafe(value) {
  return value === null || value === undefined ? '' : String(value);
}

function isFiniteNumberValue(value) {
  const n = Number(value);
  return !isNaN(n) && isFinite(n);
}

function getHeaders(sheetName) {
  if (_headerCache[sheetName]) return _headerCache[sheetName];
  const sheet = getSheet(sheetName);
  if (!sheet) return [];
  const lastCol = getLastDataCol(sheet);
  if (lastCol < 1) return [];
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

function getSheetData(sheetName) {
  const values = getSheetValues(sheetName);
  if (!values.length) return [];
  const headers = values[0];
  return values.slice(1).map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function canonicalFieldMap() {
  return {
    billno: 'BillNo',
    datetime: 'DateTime',
    customername: 'CustomerName',
    customercontact: 'CustomerContact',
    method: 'Method',
    transferid: 'TransferId',
    userid: 'User',
    user: 'User',
    subtotal: 'Subtotal',
    gsttotal: 'GSTTotal',
    grandtotal: 'GrandTotal',
    status: 'Status',
    updatedat: 'UpdatedAt',

    lineid: 'LineId',
    itemid: 'ItemID',
    itemname: 'ItemName',
    qty: 'Qty',
    rate: 'Rate',
    unitcost: 'UnitCost',
    linetype: 'LineType',
    gstrate: 'GST_Rate',
    gstamount: 'GST_Amount',
    linetotal: 'LineTotal',

    id: 'ID',
    name: 'Name',
    category: 'Category',
    unit: 'Unit',
    cost: 'Cost',
    selling: 'Selling',
    stock: 'Stock',
    minstock: 'MinStock',
    vendor: 'Vendor'
  };
}

function buildHeaderIndex(headers) {
  const canonical = canonicalFieldMap();
  const index = {};
  for (let i = 0; i < headers.length; i++) {
    const raw = headers[i];
    index[raw] = i;
    const norm = normalizeKey(raw);
    if (canonical[norm]) index[canonical[norm]] = i;
  }
  return index;
}

function getField(row, index, fieldName, fallbackIndex) {
  if (index && index[fieldName] !== undefined) return row[index[fieldName]];
  if (fallbackIndex !== undefined && row.length > fallbackIndex) return row[fallbackIndex];
  return '';
}

function setField(out, index, fieldName, value) {
  if (index[fieldName] !== undefined) out[index[fieldName]] = value;
}

function normalizeBillObjectFromRow(row, index) {
  return {
    BillNo: getField(row, index, 'BillNo', 0),
    DateTime: getField(row, index, 'DateTime', 1),
    CustomerName: getField(row, index, 'CustomerName', 2),
    CustomerContact: getField(row, index, 'CustomerContact', 3),
    Method: getField(row, index, 'Method', 4),
    TransferId: getField(row, index, 'TransferId', 5),
    User: getField(row, index, 'User', 6),
    Subtotal: toNumberSafe(getField(row, index, 'Subtotal', 7)),
    GSTTotal: toNumberSafe(getField(row, index, 'GSTTotal', 8)),
    GrandTotal: toNumberSafe(getField(row, index, 'GrandTotal', 9)),
    Status: getField(row, index, 'Status', 10),
    UpdatedAt: getField(row, index, 'UpdatedAt', 11)
  };
}

function normalizeLineObjectFromRow(row, index) {
  return {
    BillNo: getField(row, index, 'BillNo', 0),
    LineId: getField(row, index, 'LineId', 1),
    DateTime: getField(row, index, 'DateTime', 2),
    ItemID: getField(row, index, 'ItemID', 3),
    ItemName: getField(row, index, 'ItemName', 4),
    Qty: toNumberSafe(getField(row, index, 'Qty', 5)),
    Rate: toNumberSafe(getField(row, index, 'Rate', 6)),
    UnitCost: toNumberSafe(getField(row, index, 'UnitCost', index && index.LineType !== undefined ? '' : 7)),
    LineType: getField(row, index, 'LineType', 7),
    GST_Rate: toNumberSafe(getField(row, index, 'GST_Rate', 8)),
    GST_Amount: toNumberSafe(getField(row, index, 'GST_Amount', 9)),
    LineTotal: toNumberSafe(getField(row, index, 'LineTotal', 10)),
    User: getField(row, index, 'User', 11),
    Status: getField(row, index, 'Status', 12),
    UpdatedAt: getField(row, index, 'UpdatedAt', 13)
  };
}

function normalizeProductObjectFromRow(row, index) {
  return {
    ID: getField(row, index, 'ID', 0),
    Name: getField(row, index, 'Name', 1),
    Category: getField(row, index, 'Category', 2),
    Unit: getField(row, index, 'Unit', 3),
    Cost: toNumberSafe(getField(row, index, 'Cost', 4)),
    Selling: toNumberSafe(getField(row, index, 'Selling', 5)),
    Stock: toNumberSafe(getField(row, index, 'Stock', 6)),
    MinStock: toNumberSafe(getField(row, index, 'MinStock', 7)),
    Vendor: getField(row, index, 'Vendor', 8),
    UpdatedAt: getField(row, index, 'UpdatedAt', 9)
  };
}

/* =========================
   CONFIG / MASTER DATA
========================= */

function getConfig() {
  const cache = getScriptCache();
  const cacheKey = 'config_cache_v2';
  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch (_) {}
    }
  }

  const data = getSheetData(SHEET_NAMES.CONFIG);
  const config = {};
  data.forEach(function (row) {
    if (row.Key === 'staff_perms') {
      try { config[row.Key] = JSON.parse(row.Value); } catch (_) { config[row.Key] = {}; }
    } else if (['gst_rate', 'bill_no_seed', 'product_id_seed'].indexOf(row.Key) !== -1) {
      config[row.Key] = parseFloat(row.Value);
    } else {
      config[row.Key] = row.Value;
    }
  });

  if (!config.bill_prefix) config.bill_prefix = 'BILL-';
  if (!config.gst_rate && config.gst_rate !== 0) config.gst_rate = 0.05;
  if (!config.bill_no_seed) config.bill_no_seed = 1;
  if (!config.staff_perms) config.staff_perms = {};

  if (cache) {
    try { cache.put(cacheKey, JSON.stringify(config), 300); } catch (_) {}
  }
  return config;
}

function updatePermissions(body) {
  const perms = body.perms || {};
  const sheet = getSheet(SHEET_NAMES.CONFIG);
  const data = getSheetValues(SHEET_NAMES.CONFIG);

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'staff_perms') {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(perms));
      clearExecutionCache(SHEET_NAMES.CONFIG);
      try { const cache = getScriptCache(); if (cache) cache.remove('config_cache_v2'); } catch (_) {}
      return { success: true };
    }
  }

  sheet.appendRow(['staff_perms', JSON.stringify(perms)]);
  clearExecutionCache(SHEET_NAMES.CONFIG);
  try { const cache = getScriptCache(); if (cache) cache.remove('config_cache_v2'); } catch (_) {}
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
    keysToUpdate.gst_rate = gst;
  }
  if (body.bill_prefix !== undefined && body.bill_prefix !== null) {
    keysToUpdate.bill_prefix = String(body.bill_prefix);
  }

  const keys = Object.keys(keysToUpdate);
  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    if (keys.indexOf(key) !== -1) {
      sheet.getRange(i + 1, 2).setValue(keysToUpdate[key]);
    }
  }

  keys.forEach(function (key) {
    const exists = data.some(function (r) { return r[0] === key; });
    if (!exists) sheet.appendRow([key, keysToUpdate[key]]);
  });

  clearExecutionCache(SHEET_NAMES.CONFIG);
  try { const cache = getScriptCache(); if (cache) cache.remove('config_cache_v2'); } catch (_) {}
  return { success: true, updated: keysToUpdate };
}

/* =========================
   PRODUCTS / INVENTORY
========================= */

function listProducts(q, limit, start) {
  q = q || '';
  limit = limit ? parseInt(limit, 10) : 100;
  start = start ? parseInt(start, 10) : 0;

  const sheet = getSheet(SHEET_NAMES.PRODUCTS);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = getSheetValues(SHEET_NAMES.PRODUCTS);
  const headers = values[0] || [];
  const idx = buildHeaderIndex(headers);

  let products = values.slice(1).map(function (row) {
    return normalizeProductObjectFromRow(row, idx);
  });

  if (q) {
    const query = String(q).toLowerCase();
    products = products.filter(function (p) {
      return String(p.ID).toLowerCase().indexOf(query) !== -1 ||
             String(p.Name).toLowerCase().indexOf(query) !== -1 ||
             String(p.Category).toLowerCase().indexOf(query) !== -1;
    });
  }

  products.sort(function (a, b) {
    return String(a.Name || '').localeCompare(String(b.Name || ''));
  });

  return products.slice(start, start + limit);
}

function getProductById(productId) {
  if (!productId) return null;
  const values = getSheetValues(SHEET_NAMES.PRODUCTS);
  if (!values.length || values.length < 2) return null;
  const idx = buildHeaderIndex(values[0]);

  for (let i = 1; i < values.length; i++) {
    const id = getField(values[i], idx, 'ID', 0);
    if (String(id) === String(productId)) {
      return normalizeProductObjectFromRow(values[i], idx);
    }
  }
  return null;
}

function listCategories() {
  const values = getSheetValues(SHEET_NAMES.PRODUCTS);
  if (!values.length || values.length < 2) return [];
  const idx = buildHeaderIndex(values[0]);

  const set = {};
  for (let i = 1; i < values.length; i++) {
    const cat = String(getField(values[i], idx, 'Category', 2) || '').trim();
    if (cat) set[cat] = true;
  }
  return Object.keys(set).sort();
}

function getNextProductId() {
  const configSheet = getSheet(SHEET_NAMES.CONFIG);
  const data = getSheetValues(SHEET_NAMES.CONFIG);

  let seed = 1;
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'product_id_seed') {
      seed = parseInt(data[i][1], 10) || 1;
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
  try { const cache = getScriptCache(); if (cache) cache.remove('config_cache_v2'); } catch (_) {}
  return 'A' + String(seed).padStart(3, '0');
}

function saveProduct(body) {
  const product = body.product || {};
  const sheet = getSheet(SHEET_NAMES.PRODUCTS);
  const values = getSheetValues(SHEET_NAMES.PRODUCTS);
  const headers = values.length ? values[0] : ['ID','Name','Category','Unit','Cost','Selling','Stock','MinStock','Vendor','UpdatedAt'];
  const idx = buildHeaderIndex(headers);

  let rowIndex = -1;
  let id = product.ID;

  if (id) {
    for (let i = 1; i < values.length; i++) {
      if (String(getField(values[i], idx, 'ID', 0)) === String(id)) {
        rowIndex = i + 1;
        break;
      }
    }
  } else {
    id = getNextProductId();
  }

  const rowData = Array(Math.max(headers.length, 10)).fill('');
  setField(rowData, idx, 'ID', id);
  setField(rowData, idx, 'Name', product.Name || '');
  setField(rowData, idx, 'Category', product.Category || 'General');
  setField(rowData, idx, 'Unit', product.Unit || 'Pcs');
  setField(rowData, idx, 'Cost', toNumberSafe(product.Cost));
  setField(rowData, idx, 'Selling', toNumberSafe(product.Selling));
  setField(rowData, idx, 'Stock', toNumberSafe(product.Stock));
  setField(rowData, idx, 'MinStock', toNumberSafe(product.MinStock));
  setField(rowData, idx, 'Vendor', product.Vendor || '');
  setField(rowData, idx, 'UpdatedAt', new Date());

  if (rowIndex !== -1) {
    const existing = sheet.getRange(rowIndex, 1, 1, rowData.length).getValues()[0];
    for (let i = 0; i < existing.length; i++) {
      if (rowData[i] === '' && existing[i] !== undefined) rowData[i] = existing[i];
    }
    sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  clearExecutionCache(SHEET_NAMES.PRODUCTS);
  return { success: true, id: id };
}

function addCategory(body) {
  return { success: true, categoryName: body && body.categoryName ? body.categoryName : '' };
}

/* =========================
   BILLS / SALES
========================= */


function ensureSalesLineHeaders() {
  const sheet = getSheet(SHEET_NAMES.SALES_LINES);
  if (!sheet) return { error: 'Sales_Lines sheet not found' };

  const canonical = ['BillNo','LineId','DateTime','ItemID','ItemName','Qty','Rate','UnitCost','LineType','GST_Rate','GST_Amount','LineTotal','User','Status','UpdatedAt'];
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const existingNorm = {};
  existing.forEach(function (h) {
    if (h !== '' && h !== null && h !== undefined) existingNorm[normalizeKey(h)] = true;
  });

  const missing = canonical.filter(function (h) {
    return !existingNorm[normalizeKey(h)];
  });

  if (!existing.length || (existing.length === 1 && String(existing[0]) === '')) {
    sheet.getRange(1, 1, 1, canonical.length).setValues([canonical]);
    clearExecutionCache(SHEET_NAMES.SALES_LINES);
    return { success: true, headers: canonical, message: 'Canonical Sales_Lines headers inserted' };
  }

  if (!missing.length) {
    return { success: true, headers: existing, message: 'Sales_Lines headers already present' };
  }

  const newHeaders = existing.slice();
  missing.forEach(function (h) { newHeaders.push(h); });
  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
  clearExecutionCache(SHEET_NAMES.SALES_LINES);
  return { success: true, headers: newHeaders, appended: missing };
}

function getProductCostMap_() {
  const values = getSheetValues(SHEET_NAMES.PRODUCTS);
  if (!values.length || values.length < 2) return {};
  const idx = buildHeaderIndex(values[0]);
  const map = {};
  for (let i = 1; i < values.length; i++) {
    const id = String(getField(values[i], idx, 'ID', 0) || '');
    if (!id) continue;
    map[id] = toNumberSafe(getField(values[i], idx, 'Cost', 4));
  }
  return map;
}

function ensurePurchaseHeaders() {
  const sheet = getSheet(SHEET_NAMES.PURCHASES);
  if (!sheet) return { error: 'Purchase_Transactions sheet not found' };

  const canonical = ['DateTime','BillNo','Supplier','ItemID','ItemName','Qty','Cost','Total','User','Status','UpdatedAt'];
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const existingNorm = {};
  existing.forEach(function (h) {
    if (h !== '' && h !== null && h !== undefined) existingNorm[normalizeKey(h)] = true;
  });

  const missing = canonical.filter(function (h) {
    return !existingNorm[normalizeKey(h)];
  });

  if (!existing.length || (existing.length === 1 && String(existing[0]) === '')) {
    sheet.getRange(1, 1, 1, canonical.length).setValues([canonical]);
    clearExecutionCache(SHEET_NAMES.PURCHASES);
    return { success: true, headers: canonical, message: 'Canonical purchase headers inserted' };
  }

  if (!missing.length) {
    return { success: true, headers: existing, message: 'Purchase headers already present' };
  }

  const newHeaders = existing.slice();
  missing.forEach(function (h) { newHeaders.push(h); });
  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
  clearExecutionCache(SHEET_NAMES.PURCHASES);
  return { success: true, headers: newHeaders, appended: missing };
}

function ensureBillHeaders() {
  const sheet = getSheet(SHEET_NAMES.SALES_BILLS);
  if (!sheet) return { error: 'Sales_Bills sheet not found' };

  const canonical = ['BillNo','DateTime','CustomerName','CustomerContact','Method','TransferId','User','Subtotal','GSTTotal','GrandTotal','Status','UpdatedAt'];
  const lastCol = sheet.getLastColumn();
  const existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const existingNorm = {};
  existing.forEach(function (h) {
    if (h !== '' && h !== null && h !== undefined) existingNorm[normalizeKey(h)] = true;
  });

  const missing = canonical.filter(function (h) {
    return !existingNorm[normalizeKey(h)];
  });

  if (!existing.length || (existing.length === 1 && String(existing[0]) === '')) {
    sheet.getRange(1, 1, 1, canonical.length).setValues([canonical]);
    clearExecutionCache(SHEET_NAMES.SALES_BILLS);
    return { success: true, headers: canonical, message: 'Canonical headers inserted' };
  }

  if (!missing.length) {
    return { success: true, headers: existing, message: 'Headers already present' };
  }

  const newHeaders = existing.slice();
  missing.forEach(function (h) { newHeaders.push(h); });
  sheet.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
  clearExecutionCache(SHEET_NAMES.SALES_BILLS);
  return { success: true, headers: newHeaders, appended: missing };
}

function createBill(body) {
  const config = getConfig();
  const billNo = String(config.bill_prefix || 'BILL-') + String(parseInt(config.bill_no_seed, 10) || 1);

  const sheet = getSheet(SHEET_NAMES.CONFIG);
  const data = getSheetValues(SHEET_NAMES.CONFIG);
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'bill_no_seed') {
      sheet.getRange(i + 1, 2).setValue((parseInt(config.bill_no_seed, 10) || 1) + 1);
      clearExecutionCache(SHEET_NAMES.CONFIG);
      try { const cache = getScriptCache(); if (cache) cache.remove('config_cache_v2'); } catch (_) {}
      break;
    }
  }

  return { billNo: billNo };
}

function listBills(params) {
  params = params || {};
  const limit = params.limit ? parseInt(params.limit, 10) : 100;
  const offset = params.offset ? parseInt(params.offset, 10) : 0;
  const start = params.start ? String(params.start) : null;
  const end = params.end ? String(params.end) : null;
  const billNo = params.billNo ? String(params.billNo).toLowerCase() : null;

  const values = getSheetValues(SHEET_NAMES.SALES_BILLS);
  if (!values.length || values.length < 2) return [];
  const headers = values[0];
  const idx = buildHeaderIndex(headers);
  const tz = getTZ();

  const out = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const bill = normalizeBillObjectFromRow(row, idx);

    if (billNo && String(bill.BillNo || '').toLowerCase().indexOf(billNo) === -1) continue;

    const dt = bill.DateTime instanceof Date ? bill.DateTime : new Date(bill.DateTime);
    if ((start || end) && isNaN(dt.getTime())) continue;

    if (start || end) {
      const rowDate = Utilities.formatDate(dt, tz, 'yyyy-MM-dd');
      if (start && rowDate < start) continue;
      if (end && rowDate > end) continue;
    }

    out.push(bill);
  }

  out.sort(function (a, b) {
    return new Date(b.DateTime).getTime() - new Date(a.DateTime).getTime();
  });

  return out.slice(offset, offset + limit);
}

function listBillsDebug(limit) {
  limit = parseInt(limit, 10) || 20;
  const sheet = getSheet(SHEET_NAMES.SALES_BILLS);
  if (!sheet) return { error: 'Sales_Bills sheet not found' };

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1) return { headers: [], rows: [] };

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const readCount = Math.min(Math.max(0, lastRow - 1), limit);
  const rows = readCount > 0 ? sheet.getRange(2, 1, readCount, lastCol).getValues() : [];

  return { lastRow: lastRow, lastCol: lastCol, headers: headers, rows: rows };
}

function debugBillRow(billNo) {
  if (!billNo) return { error: 'billNo required' };
  const sheet = getSheet(SHEET_NAMES.SALES_BILLS);
  if (!sheet) return { error: 'Sales_Bills sheet not found' };

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { error: 'No bill rows found' };

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const rows = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

  for (let i = 0; i < rows.length; i++) {
    const idx = buildHeaderIndex(headers);
    const rowBillNo = getField(rows[i], idx, 'BillNo', 0);
    if (String(rowBillNo) === String(billNo)) {
      return {
        found: true,
        sheetRow: i + 2,
        headers: headers,
        values: rows[i]
      };
    }
  }
  return { found: false, error: 'Bill not found' };
}

function getBill(billNo) {
  if (!billNo) return null;

  const billValues = getSheetValues(SHEET_NAMES.SALES_BILLS);
  if (!billValues.length || billValues.length < 2) return null;
  const billIdx = buildHeaderIndex(billValues[0]);

  let bill = null;
  for (let i = 1; i < billValues.length; i++) {
    const b = normalizeBillObjectFromRow(billValues[i], billIdx);
    if (String(b.BillNo) === String(billNo)) {
      bill = b;
      break;
    }
  }
  if (!bill) return null;

  const lineValues = getSheetValues(SHEET_NAMES.SALES_LINES);
  if (!lineValues.length || lineValues.length < 2) return { ...bill, lines: [] };
  const lineIdx = buildHeaderIndex(lineValues[0]);

  const lines = [];
  for (let i = 1; i < lineValues.length; i++) {
    const ln = normalizeLineObjectFromRow(lineValues[i], lineIdx);
    if (String(ln.BillNo) === String(billNo) && String(ln.Status || '').toUpperCase() === 'ACTIVE') {
      lines.push(ln);
    }
  }

  return { ...bill, lines: lines };
}

function saveBill(body) {
  ensureBillHeaders();
  ensureSalesLineHeaders();

  const billNo = body.billNo || body.BillNo;
  const customerName = body.customerName || body.CustomerName || '';
  const method = body.method || body.Method || '';
  const user = body.user || body.User || '';
  const lines = body.lines || body.Lines || [];
  const customerContact = body.customerContact !== undefined ? body.customerContact : (body.CustomerContact !== undefined ? body.CustomerContact : '');
  const transferId = body.transferId !== undefined ? body.transferId : (body.TransferId !== undefined ? body.TransferId : '');
  const productCostMap = getProductCostMap_();
  const now = new Date();

  if (!billNo) return { success: false, error: 'billNo required' };

  const billsSheet = getSheet(SHEET_NAMES.SALES_BILLS);
  const billsValues = getSheetValues(SHEET_NAMES.SALES_BILLS);
  const headers = billsValues.length ? billsValues[0] : ['BillNo','DateTime','CustomerName','CustomerContact','Method','TransferId','User','Subtotal','GSTTotal','GrandTotal','Status','UpdatedAt'];
  const idx = buildHeaderIndex(headers);

  let billRowIndex = -1;
  for (let i = 1; i < billsValues.length; i++) {
    const existingBillNo = getField(billsValues[i], idx, 'BillNo', 0);
    if (String(existingBillNo) === String(billNo)) {
      billRowIndex = i + 1;
      break;
    }
  }

  if (billRowIndex !== -1) {
    const existingRow = billsValues[billRowIndex - 1];
    const existingStatus = getField(existingRow, idx, 'Status', 10);
    if (String(existingStatus || '').toUpperCase() === 'LOCKED' && !body.force) {
      return { success: false, error: 'Bill is locked and cannot be edited' };
    }
    reverseBillLines(billNo, user);
  }

  let subtotal = 0;
  let gstTotal = 0;
  const linesSheet = getSheet(SHEET_NAMES.SALES_LINES);
  const lineRows = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const qty = toNumberSafe(line.qty);
    const rate = toNumberSafe(line.rate);
    const gstRate = toNumberSafe(line.gstRate);
    const sign = String(line.lineType || 'SALE').toUpperCase() === 'RETURN' ? -1 : 1;
    const lineTotal = qty * rate;
    const gstAmount = lineTotal * gstRate;

    subtotal += sign * lineTotal;
    gstTotal += sign * gstAmount;

    const unitCost = toNumberSafe(productCostMap[String(line.itemId)] || 0);
    const lineId = Utilities.getUuid();
    lineRows.push([
      billNo, lineId, now, line.itemId, line.itemName, qty, rate, unitCost, line.lineType,
      gstRate, gstAmount, lineTotal, user, 'ACTIVE', now
    ]);

    const qtyChange = String(line.lineType || 'SALE').toUpperCase() === 'SALE' ? -qty : qty;
    updateProductStock(line.itemId, qtyChange, user, 'SALE', billNo, lineId, gstRate, gstAmount);
  }

  if (lineRows.length) {
    const startRow = linesSheet.getLastRow() + 1;
    linesSheet.getRange(startRow, 1, lineRows.length, lineRows[0].length).setValues(lineRows);
    clearExecutionCache(SHEET_NAMES.SALES_LINES);
  }

  const grandTotal = subtotal + gstTotal;
  const newStatus = body.lock ? 'LOCKED' : 'ACTIVE';

  if (billRowIndex !== -1) {
    const out = billsSheet.getRange(billRowIndex, 1, 1, Math.max(headers.length, 12)).getValues()[0];

    setField(out, idx, 'BillNo', billNo);
    if (!getField(out, idx, 'DateTime', 1)) setField(out, idx, 'DateTime', now);
    setField(out, idx, 'CustomerName', customerName);
    setField(out, idx, 'CustomerContact', customerContact);
    setField(out, idx, 'Method', method);
    setField(out, idx, 'TransferId', transferId);
    setField(out, idx, 'User', user);
    setField(out, idx, 'Subtotal', subtotal);
    setField(out, idx, 'GSTTotal', gstTotal);
    setField(out, idx, 'GrandTotal', grandTotal);
    setField(out, idx, 'Status', newStatus);
    setField(out, idx, 'UpdatedAt', now);

    billsSheet.getRange(billRowIndex, 1, 1, out.length).setValues([out]);
  } else {
    const out = Array(Math.max(headers.length, 12)).fill('');
    setField(out, idx, 'BillNo', billNo);
    setField(out, idx, 'DateTime', now);
    setField(out, idx, 'CustomerName', customerName);
    setField(out, idx, 'CustomerContact', customerContact);
    setField(out, idx, 'Method', method);
    setField(out, idx, 'TransferId', transferId);
    setField(out, idx, 'User', user);
    setField(out, idx, 'Subtotal', subtotal);
    setField(out, idx, 'GSTTotal', gstTotal);
    setField(out, idx, 'GrandTotal', grandTotal);
    setField(out, idx, 'Status', newStatus);
    setField(out, idx, 'UpdatedAt', now);
    billsSheet.appendRow(out);
  }

  clearExecutionCache(SHEET_NAMES.SALES_BILLS);
  return { success: true, billNo: billNo };
}

function reverseBillLines(billNo, user) {
  const linesSheet = getSheet(SHEET_NAMES.SALES_LINES);
  const linesValues = getSheetValues(SHEET_NAMES.SALES_LINES);
  if (!linesValues.length || linesValues.length < 2) return;
  const idx = buildHeaderIndex(linesValues[0]);
  const now = new Date();

  const updates = [];

  for (let i = 1; i < linesValues.length; i++) {
    const row = linesValues[i];
    const rowBillNo = getField(row, idx, 'BillNo', 0);
    const rowStatus = getField(row, idx, 'Status', 12);
    if (String(rowBillNo) === String(billNo) && String(rowStatus || '').toUpperCase() === 'ACTIVE') {
      const qty = toNumberSafe(getField(row, idx, 'Qty', 5));
      const lineType = String(getField(row, idx, 'LineType', 7) || '').toUpperCase();
      const gstRate = toNumberSafe(getField(row, idx, 'GST_Rate', 8));
      const gstAmount = toNumberSafe(getField(row, idx, 'GST_Amount', 9));
      const itemId = getField(row, idx, 'ItemID', 3);
      const lineId = getField(row, idx, 'LineId', 1);

      const qtyChange = lineType === 'SALE' ? qty : -qty;
      updateProductStock(itemId, qtyChange, user, 'EDIT_REVERSAL', billNo, lineId, gstRate, -gstAmount);

      updates.push({ row: i + 1 });
    }
  }

  updates.forEach(function (u) {
    if (idx.Status !== undefined) linesSheet.getRange(u.row, idx.Status + 1).setValue('REVERSED');
    if (idx.UpdatedAt !== undefined) linesSheet.getRange(u.row, idx.UpdatedAt + 1).setValue(now);
  });

  if (updates.length) clearExecutionCache(SHEET_NAMES.SALES_LINES);
}

function reopenBill(body) {
  const billNo = body && body.billNo ? String(body.billNo) : null;
  if (!billNo) return { success: false, error: 'billNo required' };

  const sheet = getSheet(SHEET_NAMES.SALES_BILLS);
  if (!sheet) return { success: false, error: 'Sales_Bills sheet not found' };

  const values = getSheetValues(SHEET_NAMES.SALES_BILLS);
  if (!values.length || values.length < 2) return { success: false, error: 'No bills found' };
  const idx = buildHeaderIndex(values[0]);

  for (let i = 1; i < values.length; i++) {
    const rowBillNo = getField(values[i], idx, 'BillNo', 0);
    if (String(rowBillNo) === billNo) {
      if (idx.Status !== undefined) sheet.getRange(i + 1, idx.Status + 1).setValue('ACTIVE');
      if (idx.UpdatedAt !== undefined) sheet.getRange(i + 1, idx.UpdatedAt + 1).setValue(new Date());
      clearExecutionCache(SHEET_NAMES.SALES_BILLS);
      return { success: true, billNo: billNo };
    }
  }

  return { success: false, error: 'Bill not found' };
}

/* =========================
   STOCK / LEDGER
========================= */

function updateProductStock(itemId, qtyChange, user, refType, refNo, refLineId, gstRate, gstAmount) {
  const productsSheet = getSheet(SHEET_NAMES.PRODUCTS);
  const ledgerSheet = getSheet(SHEET_NAMES.LEDGER);
  const productValues = getSheetValues(SHEET_NAMES.PRODUCTS);
  if (!productValues.length || productValues.length < 2) return;
  const idx = buildHeaderIndex(productValues[0]);
  const now = new Date();

  for (let i = 1; i < productValues.length; i++) {
    const rowId = getField(productValues[i], idx, 'ID', 0);
    if (String(rowId) === String(itemId)) {
      const currentStock = toNumberSafe(getField(productValues[i], idx, 'Stock', 6));
      const newStock = currentStock + toNumberSafe(qtyChange);
      const cost = toNumberSafe(getField(productValues[i], idx, 'Cost', 4));
      const itemName = getField(productValues[i], idx, 'Name', 1);

      if (idx.Stock !== undefined) productsSheet.getRange(i + 1, idx.Stock + 1).setValue(newStock);
      if (idx.UpdatedAt !== undefined) productsSheet.getRange(i + 1, idx.UpdatedAt + 1).setValue(now);

      ledgerSheet.appendRow([
        Utilities.getUuid(),
        now,
        refType,
        refNo,
        refLineId,
        itemId,
        itemName,
        qtyChange,
        cost,
        toNumberSafe(qtyChange) * cost,
        toNumberSafe(gstRate),
        toNumberSafe(gstAmount),
        user,
        ''
      ]);

      clearExecutionCache(SHEET_NAMES.PRODUCTS);
      clearExecutionCache(SHEET_NAMES.LEDGER);
      break;
    }
  }
}

function postPurchase(body) {
  ensurePurchaseHeaders();
  const billNo = body.billNo;
  const supplier = body.supplier;
  const items = body.items || [];
  const user = body.user;
  const now = new Date();
  const purchaseSheet = getSheet(SHEET_NAMES.PURCHASES);

  const rows = [];
  items.forEach(function (item) {
    const qty = toNumberSafe(item.qty);
    const cost = toNumberSafe(item.cost);
    rows.push([now, billNo, supplier, item.itemId, item.itemName, qty, cost, qty * cost, user, 'ACTIVE', now]);
    updateProductStock(item.itemId, qty, user, 'PURCHASE', billNo, '', 0, 0);
  });

  if (rows.length) {
    purchaseSheet.getRange(purchaseSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    clearExecutionCache(SHEET_NAMES.PURCHASES);
  }

  return { success: true };
}

function adjustStock(body) {
  updateProductStock(body.itemId, body.qtyChange, body.user, 'ADJUSTMENT', 'ADJ-' + Date.now(), '', 0, 0);
  return { success: true };
}

/* =========================
   AUTH
========================= */

function login(username, password) {
  if (username === 'admin' && password === 'admin123') {
    return { success: true, user: { username: 'admin', role: 'ADMIN' } };
  }

  const users = getSheetData(SHEET_NAMES.USERS);
  const user = users.find(function (u) {
    return u.Username === username && u.Password === password;
  });

  if (user) {
    return { success: true, user: { username: user.Username, role: user.Role } };
  }

  return { success: false, error: 'Invalid credentials' };
}

/* =========================
   DASHBOARD
========================= */

function getDashboardData() {
  const productValues = getSheetValues(SHEET_NAMES.PRODUCTS);
  const lineValues = getSheetValues(SHEET_NAMES.SALES_LINES);
  const billValues = getSheetValues(SHEET_NAMES.SALES_BILLS);

  const productIdx = productValues.length ? buildHeaderIndex(productValues[0]) : {};
  const lineIdx = lineValues.length ? buildHeaderIndex(lineValues[0]) : {};
  const billIdx = billValues.length ? buildHeaderIndex(billValues[0]) : {};

  const products = productValues.length > 1 ? productValues.slice(1).map(function (row) {
    return normalizeProductObjectFromRow(row, productIdx);
  }) : [];

  const lines = lineValues.length > 1 ? lineValues.slice(1).map(function (row) {
    return normalizeLineObjectFromRow(row, lineIdx);
  }) : [];

  const bills = billValues.length > 1 ? billValues.slice(1).map(function (row) {
    return normalizeBillObjectFromRow(row, billIdx);
  }) : [];

  const lowStock = products.filter(function (p) {
    return toNumberSafe(p.Stock) <= toNumberSafe(p.MinStock);
  });

  const productMap = {};
  products.forEach(function (p) { productMap[String(p.ID)] = p; });

  const salesByCategory = {};
  lines.forEach(function (line) {
    if (String(line.Status || '').toUpperCase() === 'ACTIVE' && String(line.LineType || '').toUpperCase() === 'SALE') {
      const product = productMap[String(line.ItemID)];
      const category = product ? product.Category : 'Unknown';
      salesByCategory[category] = (salesByCategory[category] || 0) + toNumberSafe(line.LineTotal);
    }
  });

  const chartData = Object.keys(salesByCategory).map(function (cat) {
    return { name: cat, value: salesByCategory[cat] };
  });

  let totalSales = 0;
  let totalTransactions = 0;
  let totalItemsSold = 0;
  const paymentTotals = {};
  const monthlyMap = {};

  bills.forEach(function (b) {
    const status = String(b.Status || '').toUpperCase();
    if (status !== 'ACTIVE') return;

    const grand = toNumberSafe(b.GrandTotal);
    if (!isFiniteNumberValue(grand)) return;
    if (Math.abs(grand) > 1000000000) return; // ignore obviously corrupted values

    totalSales += grand;
    totalTransactions += 1;

    const method = b.Method || 'UNKNOWN';
    paymentTotals[method] = (paymentTotals[method] || 0) + grand;

    const dt = b.DateTime ? new Date(b.DateTime) : null;
    if (dt && !isNaN(dt.getTime())) {
      const key = Utilities.formatDate(dt, getTZ(), 'yyyy-MM');
      monthlyMap[key] = (monthlyMap[key] || 0) + grand;
    }
  });

  lines.forEach(function (ln) {
    if (String(ln.Status || '').toUpperCase() === 'ACTIVE' && String(ln.LineType || '').toUpperCase() === 'SALE') {
      totalItemsSold += toNumberSafe(ln.Qty);
    }
  });

  const monthlyKeys = Object.keys(monthlyMap).sort();
  const monthlySales = monthlyKeys.map(function (k) {
    const parts = k.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const label = Utilities.formatDate(new Date(year, month, 1), getTZ(), 'MMM yyyy');
    return { month: k, name: label, value: monthlyMap[k] };
  });

  const paymentMethods = Object.keys(paymentTotals).map(function (m) {
    return { name: String(m), value: paymentTotals[m] };
  });

  return {
    lowStock: lowStock,
    chartData: chartData,
    monthlySales: monthlySales,
    paymentMethods: paymentMethods,
    totalSales: totalSales,
    totalTransactions: totalTransactions,
    totalItemsSold: totalItemsSold
  };
}

/* =========================
   PROFIT
========================= */

function getProfitData(params) {
  params = params || {};

  const productValues = getSheetValues(SHEET_NAMES.PRODUCTS);
  const billValues = getSheetValues(SHEET_NAMES.SALES_BILLS);
  const lineValues = getSheetValues(SHEET_NAMES.SALES_LINES);
  const purchaseValues = getSheetValues(SHEET_NAMES.PURCHASES);

  const productIdx = productValues.length ? buildHeaderIndex(productValues[0]) : {};
  const billIdx = billValues.length ? buildHeaderIndex(billValues[0]) : {};
  const lineIdx = lineValues.length ? buildHeaderIndex(lineValues[0]) : {};
  const purchaseIdx = purchaseValues.length ? buildHeaderIndex(purchaseValues[0]) : {};

  const currentProductCost = {};
  for (let i = 1; i < productValues.length; i++) {
    const p = normalizeProductObjectFromRow(productValues[i], productIdx);
    currentProductCost[String(p.ID)] = toNumberSafe(p.Cost);
  }

  // Latest known purchase cost per item as a fallback for legacy sales lines with no UnitCost.
  const latestPurchaseCost = {};
  for (let i = 1; i < purchaseValues.length; i++) {
    const row = purchaseValues[i];
    const itemId = String(getField(row, purchaseIdx, 'ItemID', 3) || '');
    if (!itemId) continue;
    latestPurchaseCost[itemId] = toNumberSafe(getField(row, purchaseIdx, 'Cost', 6));
  }

  const tz = getTZ();
  const activeBills = {};
  const monthlyRevenue = {};
  let totalRevenue = 0;

  for (let i = 1; i < billValues.length; i++) {
    const b = normalizeBillObjectFromRow(billValues[i], billIdx);
    if (String(b.Status || '').toUpperCase() !== 'ACTIVE') continue;

    const billNo = String(b.BillNo || '');
    if (!billNo) continue;

    const dt = b.DateTime ? new Date(b.DateTime) : null;
    const monthKey = dt && !isNaN(dt.getTime()) ? Utilities.formatDate(dt, tz, 'yyyy-MM') : 'unknown';

    if (params.startMonth && monthKey < params.startMonth) continue;
    if (params.endMonth && monthKey > params.endMonth) continue;

    const grand = toNumberSafe(b.GrandTotal);
    if (Math.abs(grand) > 1000000000) continue; // skip obviously corrupted rows

    activeBills[billNo] = monthKey;
    monthlyRevenue[monthKey] = (monthlyRevenue[monthKey] || 0) + grand;
    totalRevenue += grand;
  }

  const monthlyCogs = {};
  let totalCogs = 0;

  for (let i = 1; i < lineValues.length; i++) {
    const ln = normalizeLineObjectFromRow(lineValues[i], lineIdx);
    const lineStatus = String(ln.Status || '').toUpperCase();
    const lineType = String(ln.LineType || '').toUpperCase();
    const billNo = String(ln.BillNo || '');

    if (lineStatus !== 'ACTIVE') continue;
    if (lineType !== 'SALE') continue;
    if (!activeBills[billNo]) continue; // only include lines belonging to active bills in the filtered set

    const monthKey = activeBills[billNo];
    if (params.startMonth && monthKey < params.startMonth) continue;
    if (params.endMonth && monthKey > params.endMonth) continue;

    const qty = toNumberSafe(ln.Qty);
    // Prefer historical unit cost stored on the sales line. If absent (legacy data),
    // fall back to latest purchase cost, then current product cost.
    let unitCost = toNumberSafe(ln.UnitCost);
    if (!unitCost) unitCost = toNumberSafe(latestPurchaseCost[String(ln.ItemID)] || 0);
    if (!unitCost) unitCost = toNumberSafe(currentProductCost[String(ln.ItemID)] || 0);

    const lineCost = qty * unitCost;

    monthlyCogs[monthKey] = (monthlyCogs[monthKey] || 0) + lineCost;
    totalCogs += lineCost;
  }

  const monthSet = {};
  Object.keys(monthlyRevenue).forEach(function (k) { monthSet[k] = true; });
  Object.keys(monthlyCogs).forEach(function (k) { monthSet[k] = true; });

  const monthlyProfit = Object.keys(monthSet).filter(function (k) {
    return k !== 'unknown';
  }).sort().map(function (k) {
    const parts = k.split('-');
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const name = Utilities.formatDate(new Date(year, month, 1), tz, 'MMM yyyy');
    return {
      month: k,
      name: name,
      profit: (monthlyRevenue[k] || 0) - (monthlyCogs[k] || 0)
    };
  });

  return {
    totalRevenue: totalRevenue,
    cogs: totalCogs,
    netProfit: totalRevenue - totalCogs,
    monthlyProfit: monthlyProfit
  };
}

/* =========================
   CACHE UTIL
========================= */

function clearCaches(body) {
  clearExecutionCache();
  const cache = getScriptCache();
  if (!cache) return { success: true };

  if (body && Array.isArray(body.keys)) {
    body.keys.forEach(function (k) {
      try { cache.remove(k); } catch (_) {}
    });
    return { success: true, removed: body.keys };
  }

  const keys = ['config_cache_v2'];
  keys.forEach(function (k) {
    try { cache.remove(k); } catch (_) {}
  });
  return { success: true, removed: keys };
}
