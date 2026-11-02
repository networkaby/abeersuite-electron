# v1.16.23 [urgent]

Every counter must install this today. It brings a database change for product barcodes, and a counter on the old version will pause its sync once the office site is updated.

**Install on every counter first.** The office site will be updated only after all counters are on v1.16.23 — until a counter updates, its sync stops for all data, not just products.

## Barcode price on tags

- **Barcode price is now saved**: Once a product's barcode (tag) price is saved, it stays fixed. Changing the Sale Price later no longer moves the printed barcode by itself.
- **Hand-typed barcodes are marked** separately from ones made automatically from the price bands.
- **Barcode never above MRP**: a barcode higher than MRP is brought down to MRP safely.
- **Label dates use India time**, whatever time zone the PC is set to.

## Update & Print Labels screen

- Simpler filter card with sliders for each range; a range can also pick items *outside* it.
- "Profit change since last save" replaces the two Profit reduced / increased filters.
- Cost, Margin % and Stock range filters removed; a "sell at this" link sits on the Sale Price cell.

## Billing (POS)

- Each bill line now shows the lowest price (sale price) under MRP and Barcode.
- MRP is struck out only when the line is really billed below MRP.
- The lowest-price check reads the current cart correctly when you leave a price box.

## Other

- Address form: PIN code lookup is quicker and more reliable.
- WhatsApp connect settings small fixes.
