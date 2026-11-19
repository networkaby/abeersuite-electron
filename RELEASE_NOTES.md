# v1.17.11

An update for the office, database operations, and online shop product preparation workflow.

## Database & Standby Operations

- **Copy into standby now**: Added an on-demand button in Office Settings to dispatch an immediate backup copy into the standby database without waiting for the nightly cron schedule.
- **Reliable read-only locking**: Setting a database to read-only now terminates existing connection pool sessions so locks apply cleanly without stale connections blocking standby copies.
- **Accurate lock verification**: Database lock comparison ignores background telemetry timestamps on API keys, ensuring clean verification between primary and standby.

## AI Product Preparation & Photos

- **Clean background cut-out**: Product photos taken on clean backgrounds can now be automatically cut out to pure white for crisp presentation in the shop.
- **Price sticker blanking**: When an old shop price sticker covers the printed MRP, the price amount is cleanly blanked out in one tidy block so packaging details remain clear.
- **Safe photo replacements**: When photo improvements are made, the enhanced image takes its place in the gallery while preserving the original in storage for undo if ever needed.
