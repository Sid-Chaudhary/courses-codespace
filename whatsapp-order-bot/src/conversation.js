import { parseOrder } from './parser.js';

const GREETINGS = /^(hi+|hello+|hey+|hii+|helo|namaste|namaskar|salaam|salam|good (morning|afternoon|evening)|start|order|hola)[\s!.]*$/i;
const CMD = {
  menu: /^(menu|list|items|price ?list|prices|catalog(ue)?|what do you have\??)$/i,
  help: /^(help|\?|how)$/i,
  cart: /^(cart|basket|my order|view( cart| order)?|show( cart| order)?|summary|total)$/i,
  cancel: /^(cancel|clear|reset|start over|empty( cart)?|cancel order)$/i,
  done: /^(done|checkout|check out|finish(ed)?|place order|that'?s (all|it)|thats (all|it)|complete|submit|confirm order|nothing else|no more)[\s!.]*$/i,
  yes: /^(yes|y|yeah|yep|yup|ok|okay|confirm|sure|correct|haan|ha|ji|👍|✅)( please| pls)?[\s!.]*$/i,
  no: /^(no|n|nope|edit|change|back|wait)[\s!.]*$/i,
  remove: /^(remove|delete|minus|less|drop|take out|don'?t want)\s+(.+)$/i,
  name: /^(?:name|my name is)\s*[:-]?\s+(.+)$/i,
};

const fmtNum = (n) => String(Math.round(n * 1000) / 1000);

function fmtQty(qty, unit) {
  if (!unit) return fmtNum(qty);
  const short = /^(kg|g|gm|l|ml|ltr)$/i.test(unit);
  return `${fmtNum(qty)} ${!short && qty !== 1 && !unit.endsWith('s') ? `${unit}s` : unit}`;
}

export function createBot({ config, catalog, store, now = () => new Date() }) {
  const cur = config.currency || '';
  const money = (n) => `${cur}${fmtNum(n)}`;
  const expiryMs = (config.cartExpiryHours ?? 24) * 3600 * 1000;
  const allowCustomItems = !!config.allowCustomItems || catalog.length === 0;

  function menuText() {
    if (!catalog.length) {
      return 'Just tell me what you need and how many, for example:\n_2 bread, 1 milk, 6 eggs_';
    }
    const lines = catalog.map((it, i) => {
      const price = it.price != null ? ` — ${money(it.price)}${it.unit ? `/${it.unit}` : ''}` : '';
      return `${i + 1}. ${it.name}${price}`;
    });
    return `*${config.businessName} — Items*\n${lines.join('\n')}`;
  }

  const helpText = () => [
    '*How to order*',
    '• Send items with quantities, e.g. _2 kg rice, 1 milk, a dozen eggs_',
    '• *CART* – see your order so far',
    '• *REMOVE* rice – take an item out (or _remove 1 milk_)',
    '• *MENU* – see all items',
    '• *DONE* – place the order',
    '• *CANCEL* – start over',
  ].join('\n');

  function lineText(l) {
    const price = l.price != null ? ` × ${money(l.price)} = ${money(l.price * l.qty)}` : '';
    return `• ${l.name} — ${fmtQty(l.qty, l.unit)}${price}`;
  }

  function cartText(cart) {
    if (!cart.length) return 'Your cart is empty.';
    const lines = cart.map(lineText);
    const priced = cart.filter((l) => l.price != null);
    if (priced.length) {
      const total = priced.reduce((s, l) => s + l.price * l.qty, 0);
      lines.push(`*Total: ${money(total)}*${priced.length < cart.length ? ' (some items unpriced)' : ''}`);
    }
    return lines.join('\n');
  }

  function addToCart(cart, item, qty) {
    const existing = cart.find((l) => l.name === item.name);
    if (existing) existing.qty += qty;
    else cart.push({ name: item.name, qty, unit: item.unit || '', price: item.price ?? null });
  }

  function problemsText(parsed) {
    const out = [];
    for (const a of parsed.ambiguous) {
      out.push(`Which one did you mean by "${a.text}"? ${a.options.map((o) => `*${o.name}*`).join(' or ')}`);
    }
    if (parsed.unknown.length) {
      out.push(`Sorry, I couldn't find: ${parsed.unknown.map((u) => `"${u}"`).join(', ')}. Send *MENU* to see what we have.`);
    }
    return out.join('\n');
  }

  function confirmPrompt(session, customer) {
    session.state = 'awaiting_confirm';
    return `*Please check your order:*\n${cartText(session.cart)}\n\nName: ${customer.name}\n\nReply *YES* to confirm, or *EDIT* to make changes.`;
  }

  function checkout(chatId, session) {
    if (!session.cart.length) return 'Your cart is empty. Send some items first, e.g. _2 bread, 1 milk_';
    const customer = store.getCustomer(chatId);
    if (!customer?.name) {
      session.state = 'awaiting_name';
      return 'Almost done! What name should we put the order under?';
    }
    return confirmPrompt(session, customer);
  }

  function placeOrder(chatId, phone, session) {
    const customer = store.getCustomer(chatId) || {};
    const createdAt = now();
    const priced = session.cart.filter((l) => l.price != null);
    const order = {
      id: store.nextOrderId(),
      createdAt: createdAt.toISOString(),
      customerName: customer.name || '',
      phone: phone || '',
      chatId,
      items: session.cart.map((l) => ({ ...l })),
      total: priced.length ? priced.reduce((s, l) => s + l.price * l.qty, 0) : null,
    };
    store.deleteSession(chatId);
    return order;
  }

  /**
   * Handles one incoming text message.
   * @returns {{ replies: string[], order?: object }}
   */
  function handleMessage({ chatId, phone, pushName, text }) {
    const msg = (text || '').trim();
    const replies = [];
    if (!msg) return { replies };
    const t = msg.toLowerCase();

    let session = store.getSession(chatId);
    const ts = now().getTime();
    let isNew = false;
    if (session && ts - session.updatedAt > expiryMs) {
      if (session.cart.length) replies.push('Your previous unfinished order expired, so we\'re starting fresh.');
      session = null;
    }
    if (!session) {
      isNew = true;
      session = { state: 'ordering', cart: [], updatedAt: ts };
      const customer = store.getCustomer(chatId);
      const name = customer?.name || pushName;
      replies.push(`Hello${name ? ` ${name}` : ''}! 👋 Welcome to *${config.businessName}*.\n\n${menuText()}\n\nSend me what you'd like with quantities, e.g. _2 kg rice, 1 milk_. Send *HELP* for all options.`);
    }
    session.updatedAt = ts;

    const finish = (extra = {}) => {
      if (!extra.order) store.setSession(chatId, session);
      return { replies, ...extra };
    };

    // ----- commands that work at any point -----
    if (CMD.cancel.test(t)) {
      session.cart = []; session.state = 'ordering';
      replies.push('Okay, your cart has been cleared. Send items whenever you\'re ready.');
      return finish();
    }
    if (CMD.menu.test(t)) { if (!isNew) replies.push(menuText()); return finish(); }
    if (CMD.help.test(t)) { replies.push(helpText()); return finish(); }
    if (CMD.cart.test(t)) {
      replies.push(`*Your cart:*\n${cartText(session.cart)}${session.cart.length ? '\n\nSend *DONE* to place the order.' : ''}`);
      return finish();
    }
    const nameMatch = msg.match(CMD.name);
    if (nameMatch && session.state !== 'awaiting_name') {
      store.setCustomer(chatId, { ...store.getCustomer(chatId), name: nameMatch[1].trim().slice(0, 60) });
      replies.push(`Thanks, I'll put your orders under *${nameMatch[1].trim().slice(0, 60)}*.`);
      if (session.state === 'awaiting_confirm') replies.push(confirmPrompt(session, store.getCustomer(chatId)));
      return finish();
    }

    // ----- waiting for the customer's name -----
    if (session.state === 'awaiting_name') {
      const name = (nameMatch ? nameMatch[1] : msg).trim().slice(0, 60);
      store.setCustomer(chatId, { ...store.getCustomer(chatId), name });
      replies.push(confirmPrompt(session, { name }));
      return finish();
    }

    // ----- waiting for YES / EDIT -----
    if (session.state === 'awaiting_confirm') {
      if (CMD.yes.test(t) || CMD.done.test(t)) {
        const order = placeOrder(chatId, phone, session);
        replies.push(`✅ *Order ${order.id} confirmed!*\n\n${cartText(order.items)}\n\nThank you, ${order.customerName}! We'll get it ready. Send a message any time to order again.`);
        return finish({ order });
      }
      if (CMD.no.test(t)) {
        session.state = 'ordering';
        replies.push(`No problem. Your cart:\n${cartText(session.cart)}\n\nAdd more items, *REMOVE* an item, or send *DONE* when ready.`);
        return finish();
      }
      // fall through: they may be adding or removing items
      session.state = 'ordering';
    }

    // ----- ordering -----
    if (CMD.done.test(t)) { replies.push(checkout(chatId, session)); return finish(); }

    const removeMatch = msg.match(CMD.remove);
    if (removeMatch) {
      const parsed = parseOrder(removeMatch[2], session.cart.map((l) => ({ name: l.name, aliases: [] })));
      const done = []; const out = [];
      for (const { item, qty } of parsed.items) {
        const line = session.cart.find((l) => l.name === item.name);
        const explicit = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|half|dozen)\b/i.test(removeMatch[2]);
        if (explicit && qty < line.qty) { line.qty -= qty; done.push(`${fmtQty(qty, line.unit)} ${line.name}`); }
        else { session.cart = session.cart.filter((l) => l !== line); done.push(line.name); }
      }
      if (done.length) out.push(`Removed ${done.join(', ')}.`);
      const missing = [...parsed.unknown, ...parsed.ambiguous.map((a) => a.text)];
      if (missing.length) out.push(`${missing.map((m) => `"${m}"`).join(', ')} ${missing.length > 1 ? 'are' : 'is'} not in your cart.`);
      out.push(`*Your cart:*\n${cartText(session.cart)}`);
      replies.push(out.join('\n\n'));
      return finish();
    }

    if (GREETINGS.test(t)) {
      if (!isNew) replies.push(`Hi again! ${session.cart.length ? `Your cart:\n${cartText(session.cart)}\n\nAdd more or send *DONE*.` : 'What would you like to order? Send *MENU* to see items.'}`);
      return finish();
    }

    const parsed = parseOrder(msg, catalog, { allowCustomItems });
    if (!parsed.items.length && !parsed.ambiguous.length && !parsed.anyQtyGiven) {
      // Looks like chit-chat rather than an order.
      if (!isNew) replies.push('Sorry, I didn\'t understand that. Send items with quantities (e.g. _2 bread_), or *HELP* for options.');
      return finish();
    }
    for (const { item, qty } of parsed.items) addToCart(session.cart, item, qty);

    const parts = [];
    if (parsed.items.length) {
      parts.push(`Added: ${parsed.items.map(({ item, qty }) => `${fmtQty(qty, item.unit)} ${item.name}`).join(', ')} ✅`);
    }
    const problems = problemsText(parsed);
    if (problems) parts.push(problems);
    if (session.cart.length) parts.push(`*Your cart:*\n${cartText(session.cart)}\n\nSend more items, or *DONE* to place the order.`);
    replies.push(parts.join('\n\n'));
    return finish();
  }

  return { handleMessage, menuText, cartText };
}

/** Message sent to the shop owner for each new order. */
export function ownerNotification(order, config) {
  const cur = config.currency || '';
  const lines = order.items.map((l) => `• ${l.name} — ${fmtQty(l.qty, l.unit)}`);
  return [
    `🛒 *New order ${order.id}*`,
    `From: ${order.customerName || 'Unknown'}${order.phone ? ` (+${order.phone})` : ''}`,
    ...lines,
    order.total != null ? `Total: ${cur}${fmtNum(order.total)}` : '',
  ].filter(Boolean).join('\n');
}
