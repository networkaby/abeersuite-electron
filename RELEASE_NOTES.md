# v1.10.0 [urgent]

Every counter and the office app must install this today — each till restarts within 30 minutes. It brings group pricing to the POS, prints the serial no. / colour note on every bill, and lets the super admin sign in on the desktop app. It changes the database, so the counters update first and the office website follows. A counter still on the old version pauses its sync until it installs this.

## Group pricing (new)
- Pricing Strategy → Group pricing: for each customer group, choose how each product group is billed — MRP, print price (barcode tag), profit sharing X% or revenue discount X%. An "All items" row covers the rest.
- A rule on a parent product group covers its sub-groups; the nearest one wins.
- Ticks per group decide whether its customers get tier discount, coupons and loyalty.
- On the POS, picking the customer re-prices the lines the POS priced itself — a price you typed by hand is never touched.
- Profit sharing and revenue discount come quietly out of the rate before GST, only from the profit left, never below cost. Nothing extra prints.
- New POS sales only. Online orders and the office Sales invoice are not covered yet.
- A customer's own "No discount" still wins; a switched-off group gets nothing.

## Customer groups have moved
- Add, rename, switch off or delete customer groups on Group pricing. Settings → Customer Groups is gone.

## Printing
- The line note (serial no., colour) now prints under the item on every bill — counter slip, reprint, A4 tax invoice, A4 POS bill and the 80mm slip.
- Switch it off per template: Settings → Print Templates → "Line note (serial no. / colour)". On by default.

## Sign-in
- The super admin can now sign in on the desktop app, to get into a counter when nothing else works.
