export type ReceiptItem = {
  name: string;
  qty: number;
  price: number; // unit price
  gst?: boolean;
};

export type ReceiptData = {
  bill_no: string;
  date: string;
  customer: string;
  user: string;
  items: ReceiptItem[];
  subtotal: number;
  gst_total: number;
  grand_total: number;
  payment_method: string; // e.g., 'QR'
};

const CSS = `
/* Scoped receipt styles to avoid modifying host page */
.receipt-root { font-family: Calibri, 'Segoe UI', Arial, sans-serif; color:#000; line-height:1.5; }
.receipt-root * { box-sizing: border-box; color:#000; }
.receipt{width:72mm;padding:6px 6px 12px;box-sizing:border-box}
.center{text-align:center}
.header{font-weight:700;letter-spacing:0.5px;font-size:18px}
.subheader{font-size:13px}
.divider{border-top:1px dashed #222;margin:10px 0}
.bill-info{font-size:12px;margin-bottom:8px}
.bill-info .row{display:flex;justify-content:space-between;padding:2px 0}
.items{width:100%;border-collapse:collapse;font-size:12px}
.items thead th{font-size:11px;padding:6px 0 4px}
.items thead th.col-item{text-align:left}
.items thead th.col-qty{text-align:right}
.items thead th.col-total{text-align:right}
.items tbody td{padding:4px 0;vertical-align:top}
.col-item{width:58%;word-break:break-word}
.col-qty{width:12%;text-align:right;padding-left:6px}
.col-total{width:30%;text-align:right;padding-left:6px}
.price-note{font-size:10px;padding-bottom:4px}
.totals{margin-top:8px}
.totals .row{display:flex;justify-content:space-between;padding:3px 0}
.grand{font-weight:800;font-size:16px;margin-top:8px}
.footer{margin-top:10px;font-size:11px;text-align:center}
@page{size:80mm auto;margin:0}
@media print{
  .receipt-root{width:72mm;}
  .receipt{box-shadow:none;margin:0;padding:6px}
  *{ -webkit-print-color-adjust: exact; }
}
`;

function formatMoney(n: number) {
  // Keep two decimals, prefix Nu.
  return `Nu.${n.toFixed(2)}`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function generateReceiptHtml(data: ReceiptData) {
  const itemsHtml = data.items
    .map((it) => {
      const lineTotal = it.qty * it.price;
      const safeName = escapeHtml(it.name);
      const gstNote = it.gst ? ' + GST' : '';
      return `
        <tr>
          <td class="col-item">${safeName}</td>
          <td class="col-qty">${it.qty}</td>
          <td class="col-total">${formatMoney(lineTotal)}</td>
        </tr>
        <tr>
          <td colspan="3" class="price-note">${formatMoney(it.price)}${gstNote}</td>
        </tr>`;
    })
    .join('\n');

  const html = `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Receipt ${escapeHtml(data.bill_no)}</title>
    <style>${CSS}</style>
  </head>
  <body>
    <div class="receipt-root">
      <div class="receipt" role="document">
  <div class="center header">Samten Tshongkhang</div>
  <div class="center subheader">Sunday Market, Thimphu</div>
  <div class="center subheader">Phone: +975 17655336 / +975 17909608</div>
      <div class="divider"></div>

      <div class="bill-info">
        <div class="row"><div>Bill No:</div><div>${escapeHtml(data.bill_no)}</div></div>
        <div class="row"><div>Date / Time:</div><div>${escapeHtml(data.date)}</div></div>
        <div class="row"><div>Customer:</div><div>${escapeHtml(data.customer)}</div></div>
        <div class="row"><div>User:</div><div>${escapeHtml(data.user)}</div></div>
      </div>

      <div class="divider"></div>

      <table class="items" aria-label="Items">
        <thead>
          <tr><th class="col-item">Item</th><th class="col-qty">Qty</th><th class="col-total">Total</th></tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div class="divider"></div>

      <div class="totals">
        <div class="row"><div>Subtotal</div><div>${formatMoney(data.subtotal)}</div></div>
        <div class="row"><div>GST Total</div><div>${formatMoney(data.gst_total)}</div></div>
        <div class="divider"></div>
        <div class="row grand"><div>GRAND TOTAL</div><div>${formatMoney(data.grand_total)}</div></div>
      </div>

      <div class="divider"></div>

      <div class="center">PAID VIA ${escapeHtml(data.payment_method)}</div>

      <div class="divider"></div>

      <div class="footer">Thank you for shopping with us.</div>
      </div>
    </div>
  </body>
  </html>
  `;

  return html;
}

/**
 * Open a print window, render receipt HTML, and call print().
 * This function attempts to preserve exact layout by embedding CSS inline
 * and forcing the page size to 80mm in @page. It waits for resources and
 * then triggers print. Optionally closes the window after printing.
 */
export async function printReceipt(data: ReceiptData, autoClose = true) {
  const html = generateReceiptHtml(data);
  const win = window.open('', '_blank', 'toolbar=0,location=0,menubar=0');
  if (!win) throw new Error('Unable to open print window (blocked by browser)');

  win.document.open();
  win.document.write(html);
  win.document.close();

  // Wait for fonts and layout
  const tryPrint = () => {
    try {
      win.focus();
      // Call print in a setTimeout to give browser time to layout
      setTimeout(() => {
        win.print();
        if (autoClose) setTimeout(() => win.close(), 500);
      }, 200);
    } catch (err) {
      console.error('Print failed', err);
    }
  };

  // If window loaded, print; otherwise wait for load event
  if (win.document.readyState === 'complete') {
    tryPrint();
  } else {
    win.addEventListener('load', tryPrint);
    // Fallback: try after 500ms
    setTimeout(tryPrint, 500);
  }
}
