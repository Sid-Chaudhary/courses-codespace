import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  isJidGroup,
  isJidBroadcast,
  isJidNewsletter,
  isPnUser,
  jidDecode,
} from 'baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { loadCatalog } from './catalog.js';
import { Store } from './store.js';
import { createBot, ownerNotification } from './conversation.js';
import { flushPending } from './spreadsheet.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const catalog = loadCatalog(path.join(ROOT, config.itemsFile || 'items.csv'));
const DATA = path.join(ROOT, 'data');
const spreadsheet = path.resolve(ROOT, config.spreadsheetFile || 'data/orders.xlsx');
const store = new Store(path.join(DATA, 'state.json'));
const bot = createBot({ config, catalog, store });
const digits = (s) => String(s || '').replace(/\D/g, '');
const ignored = new Set((config.ignoreNumbers || []).map(digits));
const ownerJid = digits(config.ownerNumber) ? `${digits(config.ownerNumber)}@s.whatsapp.net` : null;

const log = {
  info: (m) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`),
  warn: (m) => console.warn(`[${new Date().toLocaleTimeString()}] ⚠️  ${m}`),
};
const waLogger = pino({ level: 'silent' });

log.info(`${config.businessName}: loaded ${catalog.length} item(s). Orders go to ${spreadsheet}`);

// Retry saving orders that couldn't be written (e.g. spreadsheet was open in Excel).
setInterval(() => flushPending(store, spreadsheet, log), 60_000);
flushPending(store, spreadsheet, log);

function textOf(message) {
  const m = normalizeMessageContent(message);
  if (!m) return '';
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.buttonsResponseMessage?.selectedDisplayText
    || m.listResponseMessage?.title
    || '';
}

function phoneOf(key) {
  for (const jid of [key.remoteJid, key.remoteJidAlt]) {
    if (jid && isPnUser(jid)) return jidDecode(jid).user;
  }
  return '';
}

// Handle each chat's messages one at a time, in order.
const queues = new Map();
function enqueue(chatId, task) {
  const next = (queues.get(chatId) || Promise.resolve()).then(task).catch((e) => log.warn(e.stack || e));
  queues.set(chatId, next);
  next.finally(() => { if (queues.get(chatId) === next) queues.delete(chatId); });
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(DATA, 'auth'));
  const { version } = await fetchLatestBaileysVersion().catch(() => ({}));
  const sock = makeWASocket({
    version,
    logger: waLogger,
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, waLogger) },
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nScan this QR code with WhatsApp on the business phone:');
      console.log('  WhatsApp → Settings (or ⋮) → Linked devices → Link a device\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') log.info('✅ Connected to WhatsApp. The bot is running — leave this window open.');
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log.warn('This laptop was logged out of WhatsApp. Deleting the old login — restart the bot and scan the QR again.');
        fs.rmSync(path.join(DATA, 'auth'), { recursive: true, force: true });
        process.exit(1);
      }
      log.warn(`Connection closed (${code ?? 'network'}). Reconnecting in 5s...`);
      setTimeout(() => start().catch((e) => log.warn(e.stack || e)), 5000);
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      if (!jid || msg.key.fromMe) continue;
      if (isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) continue;
      const text = textOf(msg.message);
      if (!text) continue;

      const phone = phoneOf(msg.key);
      if (phone && ignored.has(phone)) continue;
      // Skip very old messages delivered after the laptop was off for a long time.
      const sentAt = Number(msg.messageTimestamp || 0) * 1000;
      if (sentAt && Date.now() - sentAt > (config.cartExpiryHours ?? 24) * 3600 * 1000) continue;

      const chatId = phone ? `${phone}@s.whatsapp.net` : jid;
      enqueue(chatId, async () => {
        log.info(`📩 ${msg.pushName || phone || jid}: ${text.replace(/\s+/g, ' ').slice(0, 80)}`);
        await sock.readMessages([msg.key]).catch(() => {});
        const { replies, order } = bot.handleMessage({ chatId, phone, pushName: msg.pushName, text });
        for (const reply of replies) await sock.sendMessage(jid, { text: reply });
        if (order) {
          log.info(`🛒 New order ${order.id} from ${order.customerName} (${order.items.length} item(s))`);
          store.addPending(order);
          await flushPending(store, spreadsheet, log);
          if (ownerJid) await sock.sendMessage(ownerJid, { text: ownerNotification(order, config) }).catch((e) => log.warn(`Owner notification failed: ${e.message}`));
        }
      });
    }
  });
}

start().catch((e) => { console.error(e); process.exit(1); });
