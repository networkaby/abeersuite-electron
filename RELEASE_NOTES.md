# v5.0.2

A counter now knows exactly which till it is, keeps billing when the internet drops, and updates itself without anybody visiting the machine.

> Counters update themselves. The app checks for this release in the background and shows a "Restart now / Later" card when it is ready — nothing is interrupted mid-sale.

## Counter setup and release

- **One PC, one counter, decided by the office — not by the PC.** Choosing a counter number, releasing it, and moving it to a replacement machine are all settled in the database now. A counter number cannot be taken while another PC still holds it; release it first.
- **A PC that holds no counter holds no data.** Sign-in on an unassigned machine is blocked, and any leftover local data is cleared straight away.
- **Setup finishes only when the local copy is ready.** The wizard shows the copy progress and hands over to the app when the counter can genuinely work offline — no half-prepared machine.
- **A released counter is refused, even if it was offline.** A PC released by the office at 11:00 that keeps billing and reconnects at 13:00 has its queued work rejected and comes back clean, instead of quietly taking its counter back.
- **A closed shift stays closed.** A machine recovering after a force-close is offered a fresh shift instead of one the office has already settled.

## Working offline

- **Writes taken offline now reach the server in about a second** once the line is back, instead of waiting up to fifteen.
- **Nothing is lost and nothing is duplicated.** Offline work is queued in order, each counter mints its own ID range, and anything that cannot be applied is set aside for review rather than dropped silently.
- **Screens refresh when the data has actually arrived**, not a moment before — no more looking at a stale list after a sync.
- **Faster catch-up after a long outage**, and an edit made in the office (a renamed department, an edited position) now reaches counters instead of being skipped.
- **Reads fall back to the server** while the local copy is still filling, so the app is usable sooner.

## Automatic updates

- **Updates now actually install.** Earlier versions downloaded in the background and then waited for a quit that never comes on an always-on counter.
- **Installed at a safe moment, never mid-sale** — the cart must be empty and the machine idle. A "Restart now / Later" card appears; it is never forced.
- **Urgent releases** show a clear countdown so every counter restarts the same day.
- **After a database change**, the counter that needs the update is told directly rather than sitting paused.

## Backups

- **Choose your own backup days and times** from the settings page — up to five daily schedules, with an on/off switch.
- **Backups are stamped in Indian time** and named by shop and trigger, so the right file is easy to find.
- Backups now run on schedule off the machine, so a counter being switched off no longer means a missed backup.

## On screen

- **The title bar shows the counter number**, and read, write and sync are reported separately in one plain vocabulary — you can see at a glance whether the counter is serving locally, saving locally, or still catching up.
- Duplicated status badges removed from the finance bar.

## Numbering

- **Counter numbers are prefixed by branch** and unique across the shop.
- **Repair tickets** are numbered through the voucher series.
- **Vouchers are numbered by counter** rather than by user.

## Fixed

- Sign-out on a counter no longer leaves a permanent "sync error" on the badge.
- Dates entered on a counter now reach the server with the correct time, instead of shifting by a day.
- Permission checks no longer miss pool-exempt permissions.
- The shop hardware bridge is no longer served to the whole network — the customer display and thermal printer are driven inside the app.
- The installer no longer fails when Windows is slow to release files during packaging.
