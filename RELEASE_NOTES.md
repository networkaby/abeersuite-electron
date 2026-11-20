# v1.17.11

An update for the office, database operations, and online shop product preparation workflow.

## Online Shop & AI Product Preparation

- **Unified open-problem tracking**: Product issues now live in a single shared open-problem list across AI and staff. Staff can assign tasks directly to the AI using `{}` syntax in manual notes.
- **Problem resolution endpoint**: Fixed problems are immediately marked as resolved and removed from the active Attention list.
- **Run history & record keeping**: Every preparation run (including refused checks) is logged with its outcome in a compact 10-run history, converting old notes into a consistent timeline format.
- **Problem search & set-aside tickets**: Staff can tick "can't fix now" on problems without blocking other stages, and search across all products with open issues.
- **Standalone photo prep (Part 5)**: Photo preparation runs independently for products that already have copy, improving main photo cut-outs to pure white without searching the web.
- **Fresh application favicon**: Updated high-resolution application icon.

## Database & Standby Operations

- **Copy into standby now**: Added an on-demand button in Office Settings to dispatch an immediate backup copy into the standby database without waiting for the nightly cron schedule.
- **Reliable read-only locking**: Setting a database to read-only now terminates existing connection pool sessions so locks apply cleanly without stale connections blocking standby copies.
- **Accurate lock verification**: Database lock comparison ignores background telemetry timestamps on API keys, ensuring clean verification between primary and standby.
