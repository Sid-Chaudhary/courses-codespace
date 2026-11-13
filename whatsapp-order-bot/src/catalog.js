import fs from 'node:fs';

/**
 * Loads the item list from a CSV file with the columns:
 *   name, aliases, price, unit
 * - aliases: other words customers might use, separated by "|"
 * - price and unit are optional
 * The file can be edited in Excel / Google Sheets (save as CSV).
 */
export function loadCatalog(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iName = col('name');
  if (iName === -1) throw new Error(`${filePath}: first row must contain a "name" column`);
  const iAliases = col('aliases');
  const iPrice = col('price');
  const iUnit = col('unit');

  return rows.slice(1).map((r) => {
    const priceText = iPrice >= 0 ? (r[iPrice] || '').replace(/[^0-9.]/g, '') : '';
    return {
      name: (r[iName] || '').trim(),
      aliases: iAliases >= 0
        ? (r[iAliases] || '').split('|').map((a) => a.trim()).filter(Boolean)
        : [],
      price: priceText ? Number(priceText) : null,
      unit: iUnit >= 0 ? (r[iUnit] || '').trim() : '',
    };
  }).filter((item) => item.name);
}

/** Minimal CSV parser that understands quoted fields ("a, b" and "" escapes). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
