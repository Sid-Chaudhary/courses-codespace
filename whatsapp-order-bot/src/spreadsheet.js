import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const ORDER_COLUMNS = [
  { header: 'Order ID', key: 'id', width: 11 },
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Time', key: 'time', width: 9 },
  { header: 'Customer Name', key: 'customerName', width: 22 },
  { header: 'Phone', key: 'phone', width: 16 },
  { header: 'Items', key: 'items', width: 50 },
  { header: 'Total', key: 'total', width: 10 },
  { header: 'Status', key: 'status', width: 12 },
];

const ITEM_COLUMNS = [
  { header: 'Order ID', key: 'id', width: 11 },
  { header: 'Date', key: 'date', width: 12 },
  { header: 'Customer Name', key: 'customerName', width: 22 },
  { header: 'Phone', key: 'phone', width: 16 },
  { header: 'Item', key: 'item', width: 22 },
  { header: 'Quantity', key: 'qty', width: 10 },
  { header: 'Unit', key: 'unit', width: 9 },
  { header: 'Unit Price', key: 'price', width: 11 },
  { header: 'Line Total', key: 'lineTotal', width: 11 },
];

function setupSheet(wb, name, columns) {
  let ws = wb.getWorksheet(name);
  if (!ws) {
    ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns;
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: 'A1', to: { row: 1, column: columns.length } };
  } else {
    // keep column keys so addRow({...}) works on an existing file
    ws.columns = columns.map((c, i) => ({ ...c, header: ws.getRow(1).getCell(i + 1).value || c.header }));
  }
  return ws;
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Appends orders to the Excel file:
 *  - "Orders" sheet: one row per order (easy to read, has a Status column you can edit)
 *  - "Order Items" sheet: one row per item (easy to filter / total with a pivot table)
 * Times use the laptop's local time zone.
 */
export async function appendOrders(filePath, orders) {
  const wb = new ExcelJS.Workbook();
  if (fs.existsSync(filePath)) await wb.xlsx.readFile(filePath);
  const wsOrders = setupSheet(wb, 'Orders', ORDER_COLUMNS);
  const wsItems = setupSheet(wb, 'Order Items', ITEM_COLUMNS);

  for (const o of orders) {
    const d = new Date(o.createdAt);
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    wsOrders.addRow({
      id: o.id, date, time, customerName: o.customerName, phone: o.phone ? `+${o.phone}` : '',
      items: o.items.map((l) => `${l.qty}${l.unit ? ` ${l.unit}` : ''} x ${l.name}`).join(', '),
      total: o.total, status: 'New',
    });
    for (const l of o.items) {
      wsItems.addRow({
        id: o.id, date, customerName: o.customerName, phone: o.phone ? `+${o.phone}` : '',
        item: l.name, qty: l.qty, unit: l.unit, price: l.price,
        lineTotal: l.price != null ? l.price * l.qty : null,
      });
    }
  }

  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  // Write to a temp file first so a crash never leaves a half-written spreadsheet.
  const tmp = `${filePath}.tmp.xlsx`;
  await wb.xlsx.writeFile(tmp);
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Writes all pending orders from the store. If the file is locked (e.g. open in Excel on Windows),
 * the orders stay pending and are retried later — nothing is lost.
 */
export async function flushPending(store, filePath, log = console) {
  const pending = [...store.pendingOrders];
  if (!pending.length) return true;
  try {
    await appendOrders(filePath, pending);
    for (const o of pending) store.removePending(o.id);
    log.info?.(`Saved ${pending.length} order(s) to ${filePath}`);
    return true;
  } catch (err) {
    log.warn?.(`Could not write ${filePath} (${err.code || err.message}). Is it open in Excel? Will retry. ${pending.length} order(s) waiting.`);
    return false;
  }
}
