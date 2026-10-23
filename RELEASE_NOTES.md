# v1.16.12 [urgent]

Every counter should install this today. It fixes the AI Setup page on counters and brings the new **Campaigns** module (WhatsApp Channel / Status posts). **This release adds new database tables** (AI key usage, Posts and Post shares) — counters should update first; the office site is updated after that, and a counter's sync pauses until it has this version.

## AI Setup
- The "Failed to load" and "Forbidden" errors on the AI Setup page are gone.
- AI key limits (how many uses, the gap between uses, the rest time) are now shared by all counters, so a limit really holds.
- Adding, editing and reordering keys is smooth now — the row updates in place, nothing jumps back while saving, and Enter saves the key dialog.
- The old "this PC only" AI key is retired; such keys are removed from tills automatically.
- "Manage AI setup" now has its own tick in the Role Matrix.

## Campaigns (new)
- New Campaigns section in the office with its own sidebar pages; regular posts are separate from marketing campaigns.
- Prepare a WhatsApp Channel or Status post (photo + caption) in the office; staff share it from the phone app.
- Make a post straight from a shop product — caption, price and photo are filled for you, edit freely.
- Queue & Calendar: a week timetable of past and coming posts — green posted, amber due to share, violet coming.
- Product feeds for Google Merchant Center and Meta catalog, rebuilt at most once a day and only when products changed.

## Staff phone app
- New Posts screen: posts waiting for WhatsApp, due first, with one-tap Share to WhatsApp.
- The offline note no longer repeats "no answer from the server" twice.

## POS
- The customer QR display slideshow now plays offer products (biggest discount first) instead of a still photo.

## Shop website
- Shorter, cleaner web addresses for products, categories, collections and brands.

## Other
- Company PAN corrected to match the GSTIN.
- Error messages now show the server's status when it gives no reason.
