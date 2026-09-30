# v1.9.2

A safety and staff-access update for every counter and the office app. The Role page is now obeyed everywhere: a page or a voucher action that is not ticked for someone stays closed to them, even through a link or a typed address. A counter can no longer lose its unsent sales to a damaged setup file, and printing through a Windows printer driver works again. There is no database change and no rush: counters install it on their own at the next quiet moment.

**After it installs:** if a staff member says a page they used to open now shows "no access", tick that page for their role on the Role page.

## Staff access (Role page)
- **Every office page opens only on its own tick.** Before this, the sidebar hid an unticked page, but a bookmark, a typed address or a link on another screen still opened it. Now the person lands on Work Flow with a "no access" message.
- **Links to a page someone cannot open are hidden**, or shown as plain text, so a cashier is no longer led into a "no access" page from another screen.
- **Every voucher obeys its Create, Cancel / edit, Delete and Post ticks.** This covers POS Sale, Order and Estimate, Journal, POS Rcv / Exp, Sale Return, Duplicate and Convert. Before this, some of these ticks were shown but not checked.
- **"Can login outside counter" is checked with the password.** The office website is for office staff only. Anyone without the tick now sees a clear message saying why, instead of "Invalid email or password".
- Five ticks that had no box now have one: **Staff Directory edit, Attendance edit, Leave approve, Payroll run and Backup & Restore.**
- Giving **Delete** always gives **Edit** too. The Quick Actions **"POS +"** chip now gives both Start and End shift, not only Start.
- Ticking "Can change tax" no longer shows a "not seeded" warning on Save.
- A customer's shop login can no longer open staff repair tickets or staff notifications.

## Counter
- **Unsent sales are safe if the counter's setup file gets damaged**, for example by a power cut while it was being saved. Before this, a damaged file could empty the counter's local data, including sales not yet sent to the server. Now the counter sets the damaged file aside, rebuilds its setup from its own data and keeps the unsent sales.
- **Back never lands on the faces / PIN lock screen** while you are signed in.

## Printing
- **Printing to a USB printer through its Windows driver works again.** Every such print was failing.
- The printer list works on newer Windows 11 PCs too.

## Accounts
- **Receipt / Payment with bills ticked saves in one go.** Before this, it could refuse with "has only ₹… open — cannot place ₹…" because the bills were counted twice.
- **Typing an IFSC code fills Bank Name and Branch** on the company / contact Bank tab, the staff salary account, and Create / Edit Ledger. It fills only an empty box. If you have typed something different, a hint shows the bank's answer with a **Use** button, so your own entry always wins. An unknown code shows a warning but never stops a save.
- **The trading voucher's party card shows a company's balance.** Before this, a company always showed ₹0.
- **Edit Ledger shows Bill-wise details only for a party ledger** (Sundry Debtors / Sundry Creditors). Expense, bank and capital ledgers no longer show a button that led nowhere.
- **Optional Vouchers keeps your search and type filter** when you change the dates.

## Everywhere else
- **Esc closes only the box on top.** Closing a dialog, menu or dropdown with Esc no longer also takes you back a page. On the trading voucher's "Unsaved changes" prompt, Esc no longer goes back twice.
- **Home → Finance card:** every tile opens a real page now. "Cash & Bank Book" is split into Cash Book and Bank Book, like the sidebar.
- **Customers:** a new company / contact link shows at once, and an unlink disappears at once.
- **Backup & Restore:** the restore box now asks for the **DIRECT URL** and says where to copy it from.
