import React from 'react';
import { createRoot } from 'react-dom/client';
import { ReceiptPreview, printReceipt, ReceiptData } from './Receipt';

const example: ReceiptData = {
  bill_no: 'POS-5',
  date: '05/03/2026 23:11',
  customer: 'Walk-in Customer',
  user: 'Admin',
  items: [
    { name: 'Luggage Bag', qty: 2, price: 700, gst: true },
    { name: 'Water Bottle 1L', qty: 1, price: 120, gst: false },
  ],
  subtotal: 1520,
  gst_total: 70,
  grand_total: 1590,
  payment_method: 'QR',
};

// If you want to display a preview inside your app, render <ReceiptPreview data={example} />
// Example standalone mount for quick demo (not wired into the app by default):
export function mountExample(element: HTMLElement) {
  const root = createRoot(element);
  root.render(<ReceiptPreview data={example} />);
}

// For quick printing from console or code:
export function quickPrint() {
  printReceipt(example).catch((e) => console.error(e));
}

export default example;
