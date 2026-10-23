# v1.16.12 [urgent]

Every counter should install this today. It fixes the "Failed to load" and "Forbidden" errors on the AI Setup page and makes the AI key limits really hold. **This release adds one database table** (AI key usage). Counters should update first; the office site is updated after that.

## AI Setup
- The AI Setup page opens on counters again. It used to show "Failed to load".
- A new **Can manage AI keys** tick sits next to AI Setup in Admin → Role. Tick it for anyone who should add, edit, test or delete AI keys. Without it the page shows "Forbidden".
- Daily and monthly call limits, the wait between calls and the rest after an error are now shared by every counter and the website. They no longer start again when a counter restarts. Days and months follow India time.
- The "this PC only" way of keeping a key is gone. Keys are either saved on the page (locked) or kept in the .env file.

## Error messages
- When something fails without a clear reason, the message now adds what happened, for example "Failed to load (500)" or "(no answer from the server)". This helps us find the cause faster.
- On the phone app, the offline message no longer repeats itself.

## Online shop
- Product, category, collection and brand pages have shorter web addresses.
