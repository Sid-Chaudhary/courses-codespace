import fs from 'node:fs';
import path from 'node:path';

/**
 * Small JSON-file store so carts, customer names and the order counter
 * survive a restart of the laptop.
 */
export class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { lastOrderNumber: 0, sessions: {}, customers: {}, pendingOrders: [] };
    if (filePath && fs.existsSync(filePath)) {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(filePath, 'utf8')) };
    }
  }

  save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  getSession(chatId) { return this.data.sessions[chatId]; }
  setSession(chatId, session) { this.data.sessions[chatId] = session; this.save(); }
  deleteSession(chatId) { delete this.data.sessions[chatId]; this.save(); }

  getCustomer(chatId) { return this.data.customers[chatId]; }
  setCustomer(chatId, customer) { this.data.customers[chatId] = customer; this.save(); }

  nextOrderId() {
    this.data.lastOrderNumber += 1;
    this.save();
    return `ORD-${String(this.data.lastOrderNumber).padStart(4, '0')}`;
  }

  /** Orders that are confirmed but not yet written to the spreadsheet (e.g. the file was open in Excel). */
  get pendingOrders() { return this.data.pendingOrders; }
  addPending(order) { this.data.pendingOrders.push(order); this.save(); }
  removePending(orderId) {
    this.data.pendingOrders = this.data.pendingOrders.filter((o) => o.id !== orderId);
    this.save();
  }
}
