# v1.16.16

Every counter should take this update. It brings a small database change for the new Tracking Codes settings, and the desktop app no longer carries any passwords or keys inside it — it fetches them from the office each time it starts.

## Database update — counters first

- This version adds one new setting to the shop defaults (tracking codes) and one new table (the Google Business Profile connection).
- Update every counter **before** the office site is deployed. A counter left on the old version stops syncing until it updates.
- Once the office site is live, **close and reopen each counter once**, so it collects its full settings (backup, photo upload, courier, WhatsApp) from the office.

## Desktop app

- The installer now holds no passwords or keys. At every start the counter asks the office for them, and keeps a locked copy on that PC so it still starts and bills with the internet down. A key changed on the office reaches every counter at its next start.
- AI product copy and the AI Setup "Test" button always run on the office now, so they use the office's keys and work the same from every counter.

## Campaigns

- **Post to Google**: an Update post with a photo can now go to the shop's Google Business Profile by itself. Connect the listing once under Campaigns → Channels.

## Shop website and customer app

- New **Settings → Tracking Codes** page for the shop's analytics and ad pixel ids.
- The "Purchase" event is now sent only once an order is actually paid.
- Customer app: My Bills shows each bill the way the Day Book prints it — a counter bill no longer says "Online Order".
- Customer app: tap a bill to see its items, tax, total, paid and due right in the list, with **Download** and **Share** as a PDF or an image (needs app 2.2.3).
- Customer app: a copied bill link now opens the bill inside the app, with a back button.
- New Network Service logo and icons for the app, a public "Delete your account" page, and the app update link opens in Chrome again.
