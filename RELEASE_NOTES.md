# v1.3.4

A quiet update — no urgent restart needed. It will install itself at the next safe moment (empty POS cart, or when the counter is sitting on the login screen). Worth taking on every counter, because this one stops a failed load from looking like an empty shop.

## Screens tell the truth when something goes wrong

- **A page that fails to load no longer looks empty.** Earlier, when a list could not be fetched, a small message flashed for four seconds and then the screen simply read "No orders yet" — so staff believed there was no work. Now the page says plainly that the load failed and offers a retry.
- **Refreshing no longer wipes the screen while it works.** Pressing Refresh, changing a date, or editing one cell used to blank the whole report and throw away your scroll position and half-typed entries. The old figures now stay on screen while the fresh ones arrive. This covers all 20 business reports.
- **If a refresh fails over figures already on screen**, a strip appears above them saying the numbers are stale — instead of the old data quietly disappearing.
- **Failed saves were invisible on the voucher screens.** On the inventory voucher pages — challans, GRN, purchase orders, physical stock, branch transfers, rejections, manufacturing journals — the "could not save" message had nowhere to appear, so a failed save looked exactly like a saved one. Those messages now show.

## Big changes ask before they happen

- **Bulk price freeze now asks first**, and tells you how many products it is about to touch. One stray click on the header tick used to be able to re-freeze thousands of prices across the shop with no question.
- The same question now guards offline policy defaults, spend-tier deletes, and removing a courier service.

## Pricing Strategy

- **A manager who can open a Pricing Strategy page can now do the work on it.** Earlier, a Branch Manager could open Update prices, edit rows, tick them, and only find out at the Save click that the save was refused. Setting strategy points, costing draws, and saving barcode prices now go with the page itself.
- **Clearing every strategy point is still protected**, and now properly so. It needs the "Can reset all points" permission, and the server enforces it — earlier only the Reset button was hidden, so the values could be emptied by hand and saved anyway.
- **Rows you have changed but not saved are all marked now.** The count on the Save button and the amber mark on the row finally agree. Each marked row also has a small reset circle that puts the price and the selling choice back to the last saved values.
- Note for the person who manages roles: the Role screen for Pricing Strategy is simpler now — each page has its tick, plus one "Can reset all points" under Strategies. The three old per-page edit ticks are gone.

## Sync

- **A deletion made at the office now reaches the counters at once.** Earlier, deleting something on the web left it sitting on the counter until the hourly catch-up pass ran — a deleted coupon, for example, stayed usable at the till. Deletions now travel immediately, along with anything attached to them.
