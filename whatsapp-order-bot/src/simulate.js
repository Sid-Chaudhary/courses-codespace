// Try the bot in the terminal without WhatsApp:  npm run simulate
// Orders go to data/test-orders.xlsx so your real spreadsheet stays clean.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './catalog.js';
import { Store } from './store.js';
import { createBot, ownerNotification } from './conversation.js';
import { flushPending } from './spreadsheet.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const catalog = loadCatalog(path.join(ROOT, config.itemsFile || 'items.csv'));
const store = new Store(path.join(ROOT, 'data', 'test-state.json'));
const sheet = path.join(ROOT, 'data', 'test-orders.xlsx');
const bot = createBot({ config, catalog, store });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log('Simulated customer chat. Type messages as a customer would. Ctrl+C to quit.\n');
rl.setPrompt('You: ');
rl.prompt();
for await (const text of rl) {
  if (!process.stdin.isTTY) console.log(text);
  const { replies, order } = bot.handleMessage({ chatId: 'test@s.whatsapp.net', phone: '911234567890', pushName: 'Test Customer', text });
  for (const r of replies) console.log(`\nBot: ${r.replace(/\n/g, '\n     ')}\n`);
  if (order) {
    store.addPending(order);
    await flushPending(store, sheet, { info: console.log, warn: console.warn });
    console.log(`\n(Owner would receive:)\n${ownerNotification(order, config)}\n`);
  }
  rl.prompt();
}
