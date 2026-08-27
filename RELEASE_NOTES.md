# v5.0.0

## Added

- Automatic update checks for the installed desktop app — checks every 30 minutes, downloads updates in the background, and installs on next restart.
- Permanent green/red connection indicator on the counter badge.
- Custom sidebar images for the installer and uninstaller.

## Changed

- Offline writes reworked (Phase 4): sequence-ID ranges and an outbox so actions taken while offline sync reliably once connectivity returns.
- Faster first load on the desktop app — routes are pre-warmed after startup.

## Fixed

- Local reads now engage correctly after a replica reconnects — readiness no longer gets stuck stale.
- Startup no longer hangs waiting on PostgreSQL indefinitely; failures are now surfaced instead of silently discarded.
- Closed several safety and correctness gaps in offline-write sync.

## Removed

- Default credentials removed from the e2e authentication setup (security hardening).
