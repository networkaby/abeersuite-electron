# v1.17.9

Every counter should install this update. The counter's live sync now follows whichever database the office has chosen as the main one, so counters stay in step if the office ever switches databases.

## Database safety (office)

- The business now keeps two databases: the main one and a **Standby** copy that is refreshed every night.
- Settings → Backup & Restore can switch the main database to the Standby. The switch first locks the old one, refuses unless both databases answer, and rolls back if anything fails.
- After a switch, the screen says plainly when no copy has been made yet, instead of showing "copy running".
- Backup & Restore shows a red / green checklist of every setting the backups need, grouped by database, Vercel, GitHub and Dropbox. A nightly copy in the last 26 hours ticks the GitHub, Dropbox and cron rows for you.
- The nightly Standby copy is more reliable: it starts from a clean database, refuses a wrong (pooled) database address up front, and cleans stray quotes or spaces from the saved address.

## Counters

- Live updates on the counter follow the main database, so new bills and changes keep arriving after a database switch.
- Live updates now use Supabase's newer publishable keys.

## Online shop products

- AI product preparation gets a Part 5 touch-up step; the check step suggests what to run next and can carry straight on.
- Any problem the check finds parks the product in Attention, and every part leaves a "Last run" line on the product.
- Attention notes say where the product's details came from. Our own logo on a photo other than the main one is no longer flagged.

## Security

- Updated the web framework (Next.js) to a version with a known security issue fixed.
