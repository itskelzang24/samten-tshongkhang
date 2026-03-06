/**
 * Samten Inventory System - Google Apps Script Backend
 * Updated: 2026-03-04 (Sequential IDs A001, QR Payment Method)
 * 
 * Instructions:
 * 1. Create a new Google Sheet.
 * 2. Create the following tabs:
 *    - Products: ID, Name, Category, Unit, Cost, Selling, Stock, MinStock, Vendor, UpdatedAt
 *    - System_Config: Key, Value
 *    - Sales_Bills: BillNo, DateTime, CustomerName, Method, User, Subtotal, GSTTotal, GrandTotal, Status, UpdatedAt
 *    - Sales_Lines: BillNo, LineId, DateTime, ItemID, ItemName, Qty, Rate, LineType, GST_Rate, GST_Amount, LineTotal, User, Status, UpdatedAt
 *    - Purchase_Transactions: DateTime, BillNo, Supplier, ItemID, ItemName, Qty, Cost, Total, User, Status, UpdatedAt
 *    - Stock_Ledger: LedgerId (UUID), DateTime, RefType, RefNo, RefLineId, ItemID, ItemName, QtyChange, UnitCost, ValueChange, GST_Rate, GST_Amount, User, Notes
 * 3. In System_Config, add these keys:
 *    - staff_perms: {"dashboard":true,"pos":true,"restock":true,"inventory":true,"reports":true,"setup":true}
 *    - gst_rate: 0.05
 *    - bill_prefix: POS-
 *    - bill_no_seed: 1
 * 4. Paste this code into Extensions > Apps Script.
 * 5. Deploy as Web App:
 *    - Execute as: Me
 *    - Who has access: Anyone
 */

const SS = SpreadsheetApp.getActiveSpreadsheet();

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
        return jsonResponse(listBills(e.parameter.limit));
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
        default:
          return jsonResponse({ error: 'Invalid action' }, 400);
      }
    } else {
      return jsonResponse({ error: 'Lock timeout' }, 408);
    }
  } catch (err) {
    return jsonResponse({ error: err.toString() }, 500);
  } finally {
    lock.releaseLock();
  }
}

function jsonResponse(data, status = 200) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// --- Helper Functions ---

function getSheetData(sheetName) {
  const sheet = SS.getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  return data.map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function getConfig() {
  const data = getSheetData('System_Config');
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
  const products = getSheetData('Products');
  let filtered = products;
  if (q) {
    const lowerQ = q.toLowerCase();
    filtered = products.filter(p => 
      p.ID.toString().toLowerCase().includes(lowerQ) ||
      p.Name.toLowerCase().includes(lowerQ) ||
      p.Category.toLowerCase().includes(lowerQ)
    );
  }
  return filtered.slice(0, limit);
}

function listCategories() {
  const products = getSheetData('Products');
  const categories = [...new Set(products.map(p => p.Category))].filter(Boolean);
  return categories;
}

function listBills(limit = 100) {
  const bills = getSheetData('Sales_Bills');
  // Sort by DateTime descending
  const sorted = bills.sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime));
  return sorted.slice(0, limit);
}

function saveProduct(body) {
  const { product } = body;
  const sheet = SS.getSheetByName('Products');
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  
  let rowIndex = -1;
  let id = product.ID;

  if (id) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0].toString() === id.toString()) {
        rowIndex = i + 1;
        break;
      }
    }
  } else {
    // Generate Auto ID
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
  
  return { success: true, id };
}

function addCategory(body) {
  // Categories are derived from Products.Category. 
  // This endpoint can be used if we had a separate sheet, but for now we just return success
  return { success: true };
}

function getBill(billNo) {
  const bills = getSheetData('Sales_Bills');
  const bill = bills.find(b => b.BillNo === billNo);
  if (!bill) return null;
  
  const lines = getSheetData('Sales_Lines');
  const billLines = lines.filter(l => l.BillNo === billNo && l.Status === 'ACTIVE');
  
  return { ...bill, lines: billLines };
}

function createBill(body) {
  const config = getConfig();
  const billNo = config.bill_prefix + config.bill_no_seed;
  
  // Increment seed
  const sheet = SS.getSheetByName('System_Config');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'bill_no_seed') {
      sheet.getRange(i + 1, 2).setValue(config.bill_no_seed + 1);
      break;
    }
  }
  
  return { billNo };
}

function saveBill(body) {
  const { billNo, customerName, method, user, lines } = body;
  const now = new Date();
  
  // 1. Check if bill exists
  const billsSheet = SS.getSheetByName('Sales_Bills');
  const billsData = billsSheet.getDataRange().getValues();
  let billRowIndex = -1;
  for (let i = 1; i < billsData.length; i++) {
    if (billsData[i][0] === billNo) {
      billRowIndex = i + 1;
      break;
    }
  }
  
  // 2. If edit, reverse old lines
  if (billRowIndex !== -1) {
    reverseBillLines(billNo, user);
  }
  
  // 3. Post new lines
  let subtotal = 0;
  let gstTotal = 0;
  
  const linesSheet = SS.getSheetByName('Sales_Lines');
  const ledgerSheet = SS.getSheetByName('Stock_Ledger');
  const productsSheet = SS.getSheetByName('Products');
  const productsData = productsSheet.getDataRange().getValues();
  const productHeaders = productsData[0];
  
  lines.forEach((line, idx) => {
    const lineId = Utilities.getUuid();
    const lineTotal = line.qty * line.rate;
    const gstAmount = lineTotal * line.gstRate;
    const grandLineTotal = lineTotal + gstAmount;
    
    subtotal += lineTotal;
    gstTotal += gstAmount;
    
    // Write Sales_Lines
    linesSheet.appendRow([
      billNo, lineId, now, line.itemId, line.itemName, line.qty, line.rate, line.lineType, 
      line.gstRate, gstAmount, lineTotal, user, 'ACTIVE', now
    ]);
    
    // Update Stock & Ledger
    const qtyChange = line.lineType === 'SALE' ? -line.qty : line.qty;
    updateProductStock(line.itemId, qtyChange, user, 'SALE', billNo, lineId, line.gstRate, gstAmount);
  });
  
  const grandTotal = subtotal + gstTotal;
  
  // 4. Update/Create Bill
  if (billRowIndex !== -1) {
    billsSheet.getRange(billRowIndex, 3, 1, 8).setValues([[
      customerName, method, user, subtotal, gstTotal, grandTotal, 'ACTIVE', now
    ]]);
  } else {
    billsSheet.appendRow([
      billNo, now, customerName, method, user, subtotal, gstTotal, grandTotal, 'ACTIVE', now
    ]);
  }
  
  return { success: true, billNo };
}

function reverseBillLines(billNo, user) {
  const linesSheet = SS.getSheetByName('Sales_Lines');
  const linesData = linesSheet.getDataRange().getValues();
  const now = new Date();
  
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
      
      // Mark as REVERSED
      linesSheet.getRange(i + 1, 13).setValue('REVERSED');
      linesSheet.getRange(i + 1, 14).setValue(now);
      
      // Reverse Stock
      const qtyChange = line.lineType === 'SALE' ? line.qty : -line.qty;
      updateProductStock(line.itemId, qtyChange, user, 'EDIT_REVERSAL', billNo, line.lineId, line.gstRate, -line.gstAmount);
    }
  }
}

function updateProductStock(itemId, qtyChange, user, refType, refNo, refLineId, gstRate, gstAmount) {
  const productsSheet = SS.getSheetByName('Products');
  const productsData = productsSheet.getDataRange().getValues();
  const ledgerSheet = SS.getSheetByName('Stock_Ledger');
  const now = new Date();
  
  for (let i = 1; i < productsData.length; i++) {
    if (productsData[i][0].toString() === itemId.toString()) {
      const currentStock = parseFloat(productsData[i][6]);
      const newStock = currentStock + qtyChange;
      const cost = parseFloat(productsData[i][4]);
      
      // Update Products
      productsSheet.getRange(i + 1, 7).setValue(newStock);
      productsSheet.getRange(i + 1, 10).setValue(now);
      
      // Write Ledger
      ledgerSheet.appendRow([
        Utilities.getUuid(), now, refType, refNo, refLineId, itemId, productsData[i][1],
        qtyChange, cost, qtyChange * cost, gstRate, gstAmount, user, ''
      ]);
      break;
    }
  }
}

function postPurchase(body) {
  const { billNo, supplier, items, user } = body;
  const now = new Date();
  const purchaseSheet = SS.getSheetByName('Purchase_Transactions');
  
  items.forEach(item => {
    const total = item.qty * item.cost;
    purchaseSheet.appendRow([
      now, billNo, supplier, item.itemId, item.itemName, item.qty, item.cost, total, user, 'ACTIVE', now
    ]);
    
    updateProductStock(item.itemId, item.qty, user, 'PURCHASE', billNo, '', 0, 0);
  });
  
  return { success: true };
}

function adjustStock(body) {
  const { itemId, qtyChange, notes, user } = body;
  updateProductStock(itemId, qtyChange, user, 'ADJUSTMENT', 'ADJ-' + Date.now(), '', 0, 0);
  return { success: true };
}

function getNextProductId() {
  const configSheet = SS.getSheetByName('System_Config');
  const data = configSheet.getDataRange().getValues();
  let seed = 1;
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'product_id_seed') {
      seed = parseInt(data[i][1]);
      rowIndex = i + 1;
      break;
    }
  }

  // If seed doesn't exist, create it
  if (rowIndex === -1) {
    configSheet.appendRow(['product_id_seed', 2]);
  } else {
    configSheet.getRange(rowIndex, 2).setValue(seed + 1);
  }

  return 'A' + seed.toString().padStart(3, '0');
}

function login(username, password) {
  // Simple login logic. In a real app, use a Users sheet with hashed passwords.
  // For this demo, we'll use a hardcoded admin and check a Users sheet for others.
  if (username === 'admin' && password === 'admin123') {
    return { success: true, user: { username: 'admin', role: 'ADMIN' } };
  }

  const users = getSheetData('Users');
  const user = users.find(u => u.Username === username && u.Password === password);
  
  if (user) {
    return { success: true, user: { username: user.Username, role: user.Role } };
  }
  
  return { success: false, error: 'Invalid credentials' };
}

function updatePermissions(body) {
  const { perms } = body;
  const sheet = SS.getSheetByName('System_Config');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'staff_perms') {
      sheet.getRange(i + 1, 2).setValue(JSON.stringify(perms));
      return { success: true };
    }
  }
  
  sheet.appendRow(['staff_perms', JSON.stringify(perms)]);
  return { success: true };
}

function getDashboardData() {
  const products = getSheetData('Products');
  const lines = getSheetData('Sales_Lines');
  
  // 1. Low Stock Alert
  const lowStock = products.filter(p => p.Stock <= p.MinStock);
  
  // 2. Sales by Category
  const salesByCategory = {};
  lines.forEach(line => {
    if (line.Status === 'ACTIVE' && line.LineType === 'SALE') {
      // We need to find the category of the item
      const product = products.find(p => p.ID.toString() === line.ItemID.toString());
      const category = product ? product.Category : 'Unknown';
      salesByCategory[category] = (salesByCategory[category] || 0) + line.LineTotal;
    }
  });
  
  const chartData = Object.keys(salesByCategory).map(cat => ({
    name: cat,
    value: salesByCategory[cat]
  }));
  
  return {
    lowStock,
    chartData
  };
}
