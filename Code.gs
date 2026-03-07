/**
 * Samten Inventory System - Google Apps Script Backend
 * Optimized for faster data fetching and fewer Spreadsheet service calls
 * Logic preserved from original version
 */

const SS = SpreadsheetApp.getActiveSpreadsheet();

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
        return jsonResponse(listProducts(e.parameter.q, e.parameter.limit));
      case 'getBill':
        return jsonResponse(getBill(e.parameter.billNo));
      case 'listCategories':
        return jsonResponse(listCategories());
      case 'listBills':
        return jsonResponse(listBills(e.parameter));
      case 'debugBills':
        return jsonResponse(listBillsDebug(e.parameter.limit || 20));
      case 'getDashboardData':
        return jsonResponse(getDashboardData());
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
  const body = JSON.parse(e.postData.contents);
  const action = body.action;
  const lock = LockService.getScriptLock();

  try {
    if (lock.tryLock(10000)) {
      switch (action) {
        case 'createBill':
          return jsonResponse(createBill(body));
        case 'saveBill':
          return jsonResponse(saveBill(body));
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
  const data = getSheetData(SHEET_NAMES.CONFIG);
  const config = {};
  data.forEach(row => {
    if (row.Key === 'staff_perms') {
      config[row.Key] = JSON.parse(row.Value);
    } else if (['gst_rate', 'bill_no_seed'].includes(row.Key)) {
      config[row.Key] = parseFloat(row.Value);
    } else {
      config[row.Key] = row.Value;
    }
  });
  return config;
}

function listProducts(q = '', limit = 100) {
  limit = parseInt(limit, 10) || 100;
  const products = getSheetData(SHEET_NAMES.PRODUCTS);
  let filtered = products;

  if (q) {
    const lowerQ = String(q).toLowerCase();
    filtered = products.filter(p =>
      String(p.ID).toLowerCase().includes(lowerQ) ||
      String(p.Name).toLowerCase().includes(lowerQ) ||
      String(p.Category).toLowerCase().includes(lowerQ)
    );
  }

  return filtered.slice(0, limit);
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
  const start = params.start ? new Date(params.start) : null;
  const end = params.end ? new Date(params.end) : null;
  const billNo = params.billNo ? String(params.billNo).toLowerCase() : null;

  const sheet = getSheet(SHEET_NAMES.SALES_BILLS);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // Read columns A:J only
  const values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  const tz = getTZ();

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
  if (results.length > limit) results.length = limit;
  return results;
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

  if (billRowIndex !== -1) {
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
    billsSheet.getRange(billRowIndex, 3, 1, 8).setValues([[
      customerName, method, user, subtotal, gstTotal, grandTotal, 'ACTIVE', now
    ]]);
  } else {
    billsSheet.appendRow([
      billNo, now, customerName, method, user, subtotal, gstTotal, grandTotal, 'ACTIVE', now
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

  return { success: true };
}

function adjustStock(body) {
  const { itemId, qtyChange, notes, user } = body;
  updateProductStock(itemId, qtyChange, user, 'ADJUSTMENT', 'ADJ-' + Date.now(), '', 0, 0);
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
  return { success: true, updated: keysToUpdate };
}

// ------------------------------
// Dashboard
// ------------------------------

function getDashboardData() {
  const products = getSheetData(SHEET_NAMES.PRODUCTS);
  const lines = getSheetData(SHEET_NAMES.SALES_LINES);

  const lowStock = products.filter(p => Number(p.Stock) <= Number(p.MinStock));

  // Build product map once for faster category lookup
  const productMap = {};
  for (let i = 0; i < products.length; i++) {
    productMap[String(products[i].ID)] = products[i];
  }

  const salesByCategory = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.Status === 'ACTIVE' && line.LineType === 'SALE') {
      const product = productMap[String(line.ItemID)];
      const category = product ? product.Category : 'Unknown';
      salesByCategory[category] = (salesByCategory[category] || 0) + Number(line.LineTotal || 0);
    }
  }

  const chartData = Object.keys(salesByCategory).map(cat => ({
    name: cat,
    value: salesByCategory[cat]
  }));

  return {
    lowStock,
    chartData
  };
}