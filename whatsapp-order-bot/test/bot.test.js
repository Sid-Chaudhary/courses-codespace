import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { parseOrder } from '../src/parser.js';
import { loadCatalog } from '../src/catalog.js';
import { Store } from '../src/store.js';
import { createBot } from '../src/conversation.js';
import { flushPending } from '../src/spreadsheet.js';

const catalog = loadCatalog(new URL('../items.csv', import.meta.url).pathname);
const config = { businessName: 'Test Shop', currency: '₹', cartExpiryHours: 24 };
const names = (r) => r.items.map((i) => [i.item.name, i.qty]);

test('parses quantities, units, word numbers, aliases and typos', () => {
  assert.deepEqual(names(parseOrder('2 kg rice, 1 litre milk and a dozen eggs', catalog)),
    [['Rice', 2], ['Milk', 1], ['Eggs', 12]]);
  assert.deepEqual(names(parseOrder('atta x3\nchai 2\ntwo bread', catalog)),
    [['Wheat Flour', 3], ['Tea', 2], ['Bread', 2]]);
  assert.deepEqual(names(parseOrder('i want 1.5kg suger please', catalog)), [['Sugar', 1.5]]);
  assert.deepEqual(names(parseOrder('oil', catalog)), [['Cooking Oil', 1]]);
  assert.deepEqual(parseOrder('2 pizza', catalog).unknown, ['pizza']);
});

test('custom items allowed only when a quantity is given', () => {
  const r = parseOrder('3 samosa, hello', [], { allowCustomItems: true });
  assert.deepEqual(names(r), [['Samosa', 3]]);
});

function newBot(start = new Date('2026-01-01T10:00:00Z')) {
  let clock = start;
  const store = new Store(null);
  const bot = createBot({ config, catalog, store, now: () => clock });
  const say = (text) => bot.handleMessage({ chatId: 'c1', phone: '919999999999', pushName: 'Asha', text });
  return { store, say, advance: (h) => { clock = new Date(clock.getTime() + h * 3600e3); } };
}

test('full order flow: greet, add, remove, name, confirm', () => {
  const { say, store } = newBot();
  assert.match(say('hi').replies[0], /Welcome to \*Test Shop\*/);
  assert.match(say('2 rice, 3 milk').replies[0], /Added: 2 kg Rice, 3 litres Milk/);
  assert.match(say('remove 1 milk').replies.join(), /Removed 1 litre Milk/);
  assert.match(say('done').replies[0], /What name/);
  assert.match(say('Asha K').replies[0], /Total: ₹180[\s\S]*Name: Asha K/);
  const { order, replies } = say('yes');
  assert.match(replies[0], /Order ORD-0001 confirmed/);
  assert.deepEqual(order.items.map((l) => [l.name, l.qty]), [['Rice', 2], ['Milk', 2]]);
  assert.equal(order.total, 180);
  assert.equal(order.customerName, 'Asha K');
  assert.equal(store.getSession('c1'), undefined);
  // returning customer: name remembered, no name question
  say('1 bread');
  assert.match(say('done').replies[0], /Please check your order[\s\S]*Asha K/);
  assert.equal(say('yes').order.id, 'ORD-0002');
});

test('edit at confirmation, cancel and chit-chat', () => {
  const { say } = newBot();
  say('hello'); say('2 eggs'); say('name Ravi');
  assert.match(say('done').replies[0], /Please check/);
  say('edit');
  assert.match(say('4 eggs').replies[0], /Eggs — 6 pieces/);
  assert.match(say('what time do you close').replies[0], /didn't understand/);
  assert.match(say('cancel').replies[0], /cleared/);
  assert.match(say('done').replies[0], /cart is empty/);
});

test('cart expires after the configured hours', () => {
  const { say, advance } = newBot();
  say('2 rice');
  advance(25);
  assert.match(say('cart').replies[0], /expired/);
});

test('writes orders to the spreadsheet', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ordbot-'));
  const file = path.join(dir, 'orders.xlsx');
  const { say, store } = newBot();
  say('2 rice, 1 tea'); say('done'); say('Asha');
  store.addPending(say('yes').order);
  assert.equal(await flushPending(store, file, {}), true);
  say('3 eggs'); say('done');
  store.addPending(say('yes').order);
  await flushPending(store, file, {});
  assert.equal(store.pendingOrders.length, 0);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const orders = wb.getWorksheet('Orders').getSheetValues().filter(Boolean).map((r) => r.slice(1));
  assert.deepEqual(orders[0], ['Order ID', 'Date', 'Time', 'Customer Name', 'Phone', 'Items', 'Total', 'Status']);
  assert.equal(orders.length, 3);
  assert.equal(orders[1][0], 'ORD-0001');
  assert.equal(orders[1][4], '+919999999999');
  assert.equal(orders[1][5], '2 kg x Rice, 1 pack x Tea');
  assert.equal(orders[1][6], 240);
  const items = wb.getWorksheet('Order Items').getSheetValues().filter(Boolean);
  assert.equal(items.length, 4); // header + 3 item rows
  fs.rmSync(dir, { recursive: true });
});
