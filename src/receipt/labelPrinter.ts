import './labelPrinter.css';

type LabelData = {
  name?: string;
  price?: string | number;
  meta?: string;
  barcodeText?: string;
};

/**
 * printLabels
 * - Accepts an array of label data objects. Each printable sheet will contain two labels side-by-side.
 * - If odd number of labels, the last sheet will contain one label on the left and an empty right label.
 */
export async function printLabels(labels: LabelData[]) {
  // Chunk labels into pairs (2 per sheet)
  const pages: LabelData[][] = [];
  for (let i = 0; i < labels.length; i += 2) {
    pages.push([labels[i], labels[i + 1] || {}]);
  }

  const htmlParts: string[] = [];
  for (const pair of pages) {
    const left = renderLabel(pair[0]);
    const right = renderLabel(pair[1]);
    htmlParts.push(`<div class="page">${left}${right}</div>`);
  }

  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${getCssText()}</style>
  </head>
  <body>${htmlParts.join('\n')}</body>
  </html>`;

  const w = window.open('', '_blank', 'noopener');
  if (!w) throw new Error('Unable to open print window');
  w.document.write(html);
  w.document.close();
  // Wait a tick for resources to render, then print
  setTimeout(() => { w.print(); }, 250);
}

function renderLabel(d: LabelData) {
  const name = escapeHtml(String(d?.name || ''));
  const price = d?.price !== undefined ? escapeHtml(String(d.price)) : '';
  const meta = escapeHtml(String(d?.meta || ''));
  const barcode = escapeHtml(String(d?.barcodeText || ''));
  return `<div class="label">
    <div class="top"><div class="name">${name}</div><div class="price">${price}</div></div>
    <div class="meta">${meta}</div>
    <div class="barcode">${barcode}</div>
  </div>`;
}

function escapeHtml(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function getCssText() {
  // Inline the CSS so the print window doesn't need to load external stylesheet
  return `@page { size: 3.3in 1.2in; margin: 0; }
  html, body { width: 3.3in; height: 1.2in; margin: 0; padding: 0; }
  .page { box-sizing: border-box; width: 3.3in; height: 1.2in; padding: 0.05in 0.1in; display: flex; align-items: center; justify-content: space-between; gap: 0.1in; page-break-after: always; }
  .label { box-sizing: border-box; width: 1.5in; height: 1.0in; border: 0.5pt solid #000; padding: 0.06in; display: flex; flex-direction: column; justify-content: space-between; font-family: Calibri, Arial, sans-serif; color: #000; }
  .label .top { display:flex; justify-content: space-between; align-items: baseline; }
  .label .name { font-size: 13px; font-weight: 600; }
  .label .price { font-size: 12px; font-weight: 700; }
  .label .meta { font-size: 9px; color: #111; }
  .label .barcode { display:block; text-align:center; font-size:10px; letter-spacing:1px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`;
}
