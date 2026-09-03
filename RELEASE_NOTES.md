# v5.0.1

## Fixed

- Auto-update now actually installs on a counter that lives in the tray: a downloaded update installs by itself at a safe moment (empty cart, PC idle or on the login screen) instead of waiting for a quit that never comes. A card offers "Restart now" or "Later".
- Updates could never download: the packaged app shipped no updater config file, so the download step failed after a successful check. The app now writes its own.
- Schema drift on a counter now triggers an immediate update check and a short countdown, instead of pausing billing until someone at the office notices.

## Added

- Urgent releases: `[urgent]` in these notes puts a countdown on every counter's screen.
- Tray menu: "Check for updates".
