# WhatsApp Order Bot

A small chatbot you run on your own (old) laptop. Customers message your WhatsApp
number, the bot collects **which items they want and how many**, asks them to confirm,
and saves every confirmed order into an **Excel spreadsheet** (`data/orders.xlsx`).

```
Customer: hi
Bot:      Hello Priya! 👋 Welcome to My Shop.  1. Rice — ₹60/kg  2. Wheat Flour ...
Customer: I need 2kg rice, 1 litre milk and a dozen eggs
Bot:      Added: 2 kg Rice, 1 litre Milk, 12 pieces Eggs ✅   Total: ₹234 ... send DONE
Customer: remove milk
Customer: done
Bot:      Please check your order: ... Reply YES to confirm, or EDIT to make changes.
Customer: yes
Bot:      ✅ Order ORD-0001 confirmed!
```

**What it understands:** `2 rice`, `rice x2`, `rice 2`, `2kg rice`, `two bread`,
`a dozen eggs`, several items in one message (separated by commas, new lines or "and"),
nicknames you set (`atta` → Wheat Flour) and small typos (`suger` → Sugar).
Commands: **MENU**, **CART**, **REMOVE** _item_ (or `remove 1 milk`), **DONE**, **CANCEL**,
**HELP**, **NAME** _new name_.

**The spreadsheet** has two sheets:
- **Orders** – one row per order: Order ID, Date, Time, Customer Name, Phone, Items, Total, Status
  (Status starts as `New`; change it yourself to `Packed`, `Delivered`, …).
- **Order Items** – one row per item, handy for filtering or a pivot table
  ("how many kg of rice did we sell this week?").

Optionally the bot also WhatsApps **you** a summary of each new order.

---

## 1. What you need

- The old laptop (Windows, Linux or Mac), connected to the internet. 2 GB RAM is plenty —
  the bot does not run a browser.
- **Node.js 20 or newer**: download the "LTS" installer from <https://nodejs.org>.
- A phone with the WhatsApp number customers will message. **Strongly recommended:** use a
  separate business number with the free *WhatsApp Business* app, not your personal number
  (otherwise the bot will reply to friends and family too).

## 2. Install

Copy this `whatsapp-order-bot` folder onto the laptop, open a terminal
(Windows: *Command Prompt* or *PowerShell*) in the folder and run:

```
npm install
```

## 3. Set up your items and shop details

**`items.csv`** – your product list. Open it in Excel/Google Sheets/Notepad and edit it,
then save as CSV:

| name | aliases | price | unit |
|---|---|---|---|
| Rice | chawal\|basmati | 60 | kg |
| Eggs | egg\|anda | 7 | piece |

- `aliases` = other words customers use, separated by `|` (optional)
- `price` and `unit` are optional. Leave price empty if you don't want totals.

**`config.json`** – open in Notepad:

| setting | meaning |
|---|---|
| `businessName` | Shown in the welcome message |
| `ownerNumber` | Your personal number **with country code**, digits only (e.g. `919876543210`). Each new order is sent here. Leave `""` to turn off. |
| `currency` | Symbol shown before prices, e.g. `"₹"`, `"$"`, `"£"` |
| `allowCustomItems` | `false` = only accept items from `items.csv`. `true` = accept anything (e.g. `3 samosa`) — useful if you don't want to keep a list. If `items.csv` is empty, anything is accepted. |
| `cartExpiryHours` | Unfinished carts are cleared after this many hours (default 24) |
| `spreadsheetFile` | Where orders are saved (default `data/orders.xlsx`) |
| `ignoreNumbers` | Numbers the bot should never reply to, e.g. `["919876543210"]` |

Restart the bot after changing either file.

**Try it without WhatsApp first:**

```
npm run simulate
```

You chat with the bot in the terminal as if you were a customer. Test orders go to
`data/test-orders.xlsx`, so your real spreadsheet stays clean.

## 4. Connect WhatsApp

```
npm start
```

A QR code appears in the terminal. On the business phone open WhatsApp →
**Settings** (or ⋮) → **Linked devices** → **Link a device**, and scan it.
When you see `✅ Connected to WhatsApp` the bot is live. The login is saved in
`data/auth/`, so you only scan once.

The phone does **not** need to stay on next to the laptop, but open WhatsApp on it at
least every couple of weeks or WhatsApp unlinks the laptop. You can still use WhatsApp
on the phone normally — you'll see the bot's replies there too.

## 5. Keep it running 24/7 on the old laptop

1. **Stop it sleeping:** set power options to *never sleep* when plugged in, and set
   "closing the lid" to *do nothing* (Windows: Control Panel → Power Options;
   Ubuntu: Settings → Power, and set `HandleLidSwitch=ignore` in `/etc/systemd/logind.conf`).
2. **Start automatically and restart if it crashes** — easiest is `pm2`:

   ```
   npm install -g pm2
   pm2 start src/index.js --name order-bot
   pm2 save
   pm2 startup          # Linux/Mac: run the command it prints
   ```
   On Windows, instead put a shortcut to `start-bot.bat` in the Startup folder
   (press Win+R, type `shell:startup`). `pm2 logs order-bot` shows what the bot is doing.

**About the spreadsheet being open:** you can open `orders.xlsx` any time. If Excel has it
open (Windows locks the file), new orders wait safely in `data/state.json` and are added
automatically within a minute after you close Excel. Close Excel when you're done looking,
and don't add your own rows in the middle; editing the Status column is fine.

**Backups:** copy the `data` folder now and then (or put `spreadsheetFile` inside a
OneDrive/Dropbox/Google Drive folder). Keep `data/auth` private — it is the WhatsApp login.

## Troubleshooting

| Problem | Fix |
|---|---|
| "logged out" message | You unlinked the device on the phone. Run `npm start` again and rescan the QR. |
| Bot doesn't reply | Is the terminal / `pm2` still running? Is the laptop online? Group chats are ignored on purpose. |
| An item isn't recognised | Add the word customers use to its `aliases` in `items.csv`, then restart. |
| Start fresh (delete all carts, order counter, login) | Stop the bot and delete the `data` folder (back up `orders.xlsx` first!). |

## Important: WhatsApp's rules

This bot connects the same way *WhatsApp Web* does, using the open-source
[Baileys](https://github.com/WhiskeySockets/Baileys) library. It is **not** an official
WhatsApp product, and WhatsApp's terms don't allow automated/unofficial clients, so there is
a risk the number gets banned. To keep that risk low: only reply to people who message you
(the bot never messages customers first), don't send bulk or promotional messages, and use a
dedicated business number rather than your personal one. If the business grows, the
official route is the **WhatsApp Business Platform (Cloud API)**, which needs a Meta business
account and a public web address; the order logic in `src/conversation.js` can be reused.

## For developers

```
npm test          # parser, conversation flow and spreadsheet tests
```

- `src/parser.js` – turns text into items + quantities
- `src/conversation.js` – the chat state machine (no WhatsApp code, easy to test)
- `src/spreadsheet.js` – writes the Excel file (with retry if it's locked)
- `src/index.js` – WhatsApp connection (Baileys)
- `src/simulate.js` – terminal chat for testing
