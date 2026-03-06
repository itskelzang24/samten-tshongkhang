/**
 * Simple ESC/POS generator for thermal receipts.
 * This implements a small subset of ESC/POS commands to support
 * alignment, bold, divider lines, and cut. The returned value is a Uint8Array
 * which can be sent to a printer via a compatible bridge (WebUSB, native, server-side).
 */

export type ReceiptItem = { name: string; qty: number; price: number; gst?: boolean };
export type ReceiptData = {
  bill_no: string;
  date: string;
  customer: string;
  user: string;
  items: ReceiptItem[];
  subtotal: number;
  gst_total: number;
  grand_total: number;
  payment_method: string;
};

function strToBytes(s: string) {
  // UTF-8 encoder
  return new TextEncoder().encode(s);
}

function concat(...arrs: Uint8Array[]) {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrs) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

export function generateEscPos(data: ReceiptData) {
  const ESC = 0x1b;
  const GS = 0x1d;
  const LF = 0x0a;

  const cmds: Uint8Array[] = [];

  // Initialize printer
  cmds.push(new Uint8Array([ESC, 0x40]));

  // Center header
  cmds.push(new Uint8Array([ESC, 0x61, 0x01])); // align center
  cmds.push(new Uint8Array([ESC, 0x45, 0x01])); // bold on
  cmds.push(strToBytes('Samten Tshongkhang'));
  cmds.push(new Uint8Array([LF]));
  cmds.push(new Uint8Array([ESC, 0x45, 0x00])); // bold off
  cmds.push(strToBytes('Sunday Market, Thimphu'));
  cmds.push(new Uint8Array([LF]));
  cmds.push(strToBytes('Phone: +975 17655336 / +975 17909608'));
  cmds.push(new Uint8Array([LF, LF]));

  // Left align for body
  cmds.push(new Uint8Array([ESC, 0x61, 0x00]));

  cmds.push(strToBytes(`Bill No: ${data.bill_no}`));
  cmds.push(new Uint8Array([LF]));
  cmds.push(strToBytes(`Date: ${data.date}`));
  cmds.push(new Uint8Array([LF]));
  cmds.push(strToBytes(`Customer: ${data.customer}`));
  cmds.push(new Uint8Array([LF]));
  cmds.push(strToBytes(`User: ${data.user}`));
  cmds.push(new Uint8Array([LF]));

  // Divider
  cmds.push(strToBytes('--------------------------------'));
  cmds.push(new Uint8Array([LF]));

  // Items: we'll format using fixed columns. Assume printer is 48-58 chars wide (80mm ~ 576 dots)
  for (const it of data.items) {
    const line = `${it.name}`;
    // Format: name padded, qty right-aligned in 3 chars, total right-aligned in 10 chars
    const total = (it.qty * it.price).toFixed(2);
    // Basic padding to keep columns aligned
    const nameCol = line.length > 24 ? line.substring(0, 24) : line.padEnd(24, ' ');
    const qtyCol = String(it.qty).padStart(3, ' ');
    const totalCol = (`Nu.${total}`).padStart(12, ' ');
    cmds.push(strToBytes(nameCol + qtyCol + totalCol));
    cmds.push(new Uint8Array([LF]));
    // price line
    const priceLine = ` ${('Nu.' + it.price.toFixed(2)).padStart(12, ' ')}${it.gst ? ' + GST' : ''}`;
    cmds.push(strToBytes(priceLine));
    cmds.push(new Uint8Array([LF]));
  }

  // Totals
  cmds.push(new Uint8Array([LF]));
  cmds.push(strToBytes(`Subtotal:`.padEnd(28, ' ') + `Nu.${data.subtotal.toFixed(2)}`));
  cmds.push(new Uint8Array([LF]));
  cmds.push(strToBytes(`GST Total:`.padEnd(28, ' ') + `Nu.${data.gst_total.toFixed(2)}`));
  cmds.push(new Uint8Array([LF]));

  // Grand total bold and center
  cmds.push(new Uint8Array([ESC, 0x61, 0x01])); // center
  cmds.push(new Uint8Array([ESC, 0x45, 0x01])); // bold
  cmds.push(strToBytes(`GRAND TOTAL: Nu.${data.grand_total.toFixed(2)}`));
  cmds.push(new Uint8Array([LF]));
  cmds.push(new Uint8Array([ESC, 0x45, 0x00])); // bold off
  cmds.push(new Uint8Array([ESC, 0x61, 0x00])); // left

  cmds.push(new Uint8Array([LF]));
  cmds.push(strToBytes(`PAID VIA ${data.payment_method}`));
  cmds.push(new Uint8Array([LF, LF]));

  cmds.push(strToBytes('Thank you for shopping with us'));
  cmds.push(new Uint8Array([LF]));
  cmds.push(strToBytes('Powered by Samten Inventory System'));
  cmds.push(new Uint8Array([LF, LF]));

  // Cut paper (partial)
  cmds.push(new Uint8Array([GS, 0x56, 0x41, 0x00]));

  return concat(...cmds);
}

// Example usage (for documentation):
// const bytes = generateEscPos(myData);
// send bytes to printer via WebUSB, serial bridge, or server-side gateway.
