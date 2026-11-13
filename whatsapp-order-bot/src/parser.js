/**
 * Turns free text like "2 kg rice, 1 milk and a dozen eggs" into
 * [{ text: 'rice', qty: 2 }, { text: 'milk', qty: 1 }, { text: 'eggs', qty: 12 }]
 * and matches each one against the item list.
 */

const WORD_NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
  half: 0.5, dozen: 12,
};

// Unit words customers may type next to the number. They are dropped
// (the item's own unit from items.csv is shown instead), except "dozen" which multiplies by 12.
const UNIT_WORDS = [
  'dozen', 'dozens', 'kgs', 'kg', 'kilo', 'kilos', 'g', 'gm', 'gms', 'gram', 'grams',
  'l', 'ltr', 'ltrs', 'litre', 'litres', 'liter', 'liters', 'ml',
  'pcs', 'pc', 'piece', 'pieces', 'nos', 'no', 'units', 'unit',
  'pack', 'packs', 'packet', 'packets', 'box', 'boxes', 'bottle', 'bottles',
  'bag', 'bags', 'tray', 'trays', 'loaf', 'loaves',
];

const FILLER = /^(hi|hello|hey|ok|okay|pls|please|plz|kindly|also|and|i want|i need|i would like|i'd like|give me|can i get|can i have|could i get|send me|send|add|need|want|order)\b[\s,:-]*/i;

const NUM = `(\\d+(?:[.,]\\d+)?|\\b(?:${Object.keys(WORD_NUMBERS).join('|')})\\b)`;
const UNIT = `(?:(${UNIT_WORDS.join('|')})\\b\\.?)`;
const LEADING = new RegExp(`^${NUM}\\s*(?:x|×|\\*)?\\s*${UNIT}?\\s*(?:of\\s+)?(.+)$`, 'i');
const TRAILING = new RegExp(`^(.+?)\\s*(?:[-:=x×*]|qty)?\\s*${NUM}\\s*${UNIT}?$`, 'i');

function toNumber(token) {
  const t = token.toLowerCase();
  if (t in WORD_NUMBERS) return WORD_NUMBERS[t];
  return Number(t.replace(',', '.'));
}

function stripFiller(s) {
  let prev;
  do { prev = s; s = s.replace(FILLER, '').trim(); } while (s !== prev);
  return s.replace(/[.!?]+$/, '').replace(/\bplease\b|\bpls\b|\bplz\b/gi, '').trim();
}

/** Splits one segment into { text, qty, qtyGiven } */
export function parseSegment(raw) {
  const s = stripFiller(raw.trim());
  if (!s) return null;

  let m = s.match(LEADING);
  // "a" / "an" only count as a quantity when followed by more words ("a loaf of bread").
  if (m && m[3] && m[3].trim()) {
    let qty = toNumber(m[1]);
    if (m[2] && /^dozens?$/i.test(m[2])) qty *= 12;
    return { text: m[3].trim(), qty, qtyGiven: !/^(a|an)$/i.test(m[1]) || !!m[2] };
  }
  m = s.match(TRAILING);
  if (m && m[1].trim() && !/^(a|an)$/i.test(m[2])) {
    let qty = toNumber(m[2]);
    if (m[3] && /^dozens?$/i.test(m[3])) qty *= 12;
    return { text: m[1].trim(), qty, qtyGiven: true };
  }
  return { text: s, qty: 1, qtyGiven: false };
}

/** Breaks a message into item segments on commas, new lines, "and", "&", "+", ";". */
export function splitSegments(text, catalog = []) {
  const parts = text.split(/[\n,;+&]+/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    // Keep "salt and pepper" together when it is itself an item name.
    if (/\band\b/i.test(part) && !matchItem(parseSegment(part)?.text || '', catalog).item) {
      out.push(...part.split(/\band\b/i).map((p) => p.trim()).filter(Boolean));
    } else {
      out.push(part);
    }
  }
  return out;
}

export function normalize(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function singular(word) {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (/(ses|xes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const words = (s) => normalize(s).split(' ').filter(Boolean).map(singular);

function similarity(a, b) {
  if (a === b) return 1;
  const m = a.length; const n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

function score(text, key) {
  const tw = words(text); const kw = words(key);
  if (!tw.length || !kw.length) return 0;
  const t = tw.join(' '); const k = kw.join(' ');
  if (t === k) return 100;
  if (kw.every((w) => tw.includes(w)) || tw.every((w) => kw.includes(w))) return 80;
  const sim = similarity(t, k);
  if (sim >= 0.75) return Math.round(sim * 70);
  // typo in one word of a multi-word name, e.g. "cookng oil"
  const wordHits = tw.filter((w) => kw.some((k2) => similarity(w, k2) >= 0.8)).length;
  if (wordHits && wordHits === tw.length) return 50;
  return 0;
}

/**
 * Finds the catalog item a piece of text refers to.
 * Returns { item } on a clear match, { options: [...] } if several items fit equally, or {} if none.
 */
export function matchItem(text, catalog) {
  if (!text || !catalog.length) return {};
  let best = 0; let hits = [];
  for (const item of catalog) {
    const s = Math.max(...[item.name, ...item.aliases].map((k) => score(text, k)));
    if (s > best) { best = s; hits = [item]; } else if (s === best && s > 0) hits.push(item);
  }
  if (!best) return {};
  if (hits.length === 1) return { item: hits[0] };
  return { options: hits };
}

/**
 * Parses an order message.
 * @returns {{ items: {item, qty}[], unknown: string[], ambiguous: {text, options}[], anyQtyGiven: boolean }}
 */
export function parseOrder(text, catalog, { allowCustomItems = false } = {}) {
  const result = { items: [], unknown: [], ambiguous: [], anyQtyGiven: false };
  for (const seg of splitSegments(text, catalog)) {
    const parsed = parseSegment(seg);
    if (!parsed || !(parsed.qty > 0)) continue;
    if (parsed.qtyGiven) result.anyQtyGiven = true;
    const match = matchItem(parsed.text, catalog);
    if (match.item) {
      result.items.push({ item: match.item, qty: parsed.qty });
    } else if (match.options) {
      result.ambiguous.push({ text: parsed.text, options: match.options });
    } else if (allowCustomItems && parsed.qtyGiven) {
      const name = parsed.text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
      result.items.push({ item: { name, aliases: [], price: null, unit: '' }, qty: parsed.qty });
    } else {
      result.unknown.push(parsed.text);
    }
  }
  return result;
}
