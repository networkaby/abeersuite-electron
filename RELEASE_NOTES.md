# v1.16.26

An important update — it carries a database change, so every counter must take it before the office site is updated. The counter will show the countdown and restart itself at a free moment. Until a counter is updated, its sync pauses once the office side changes. It also fixes a sync stop that some counters showed as "Copy incomplete".

## Sync

- A value that moves from one row to another (for example a name or code handed from one group to another) no longer stops that table from syncing on the counter.

## Accounts and books

- Ledgers now take the branch from the voucher itself, so the ledger and the Day Book always show the same branch (the old per-line branch, often blank, is removed).
- Bill amounts in the books are read from the ledger entries, so an edited bill never shows an old total.
- **Payment voucher:** a scan-to-pay UPI QR can be shown for the party.
- **Loans Book:** new **Charge Interest** button; it picks this loan's own last interest ledger by default.

## Staff attendance and payroll

- **Bulk mark** on the attendance register — wider form, W / H switch, and an Auto option. It never overwrites days the counter recorded unless you choose to.
- Off days can be marked W or H by hand; a legend and Help button explain Auto, manual and late.
- An Auto holiday is no longer paid as Absent.
- Payroll has a friendlier period picker and a read-only **See on Auto** comparison.

## Inventory

- Product groups and Collections show an **Items** count (subgroups included); tapping it opens Products filtered to that group. Both screens keep their scroll position on Back.

## Online shop

- New **/shop** browse page; every new group and collection gets its own link automatically.
- Search suggestions as you type, results in order of best match, and "did you mean" for spelling slips.
- Best sellers, Buy again and Recently viewed are built from real orders and visits; product pages show related items and "bought together".
- The catalog is one clean grid with tidier filters; category tiles and banners open the right page instead of dead links.
- Customize Home can set how many category, collection and brand tiles show.
