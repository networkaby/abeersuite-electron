# v1.0.3

A setup, update and counter-numbering fixes release. Nothing about billing, stock, or
reports changes. There is no database change in this version, so your office server
needs nothing done to it before counters take this build — install it when convenient.

## Counter numbering

- Fixed a bug that could let two counters mint the same bill/voucher number after a
  counter's number was changed (renumbered) to a lower value, or after old rows were
  brought back into a counter's range. This could have caused two different bills to
  quietly overwrite each other when syncing to the office server.
- Changing a counter's number is now blocked while that counter's PC is still checked
  in — it must first be released from `Setup > Counter` before it can be given to a
  different counter number. This closes the same gap from the other side.

## Uninstalling AbeerSuite from a counter

- Uninstalling now removes the local copy of the shop database and its settings files
  from the PC. Until this version, uninstalling only removed the program itself and
  left behind a full copy of your shop's data — about 300 MB, including the database
  password — sitting unprotected on the machine. This matters most when a counter PC
  is being retired, sold, or handed to someone else. (Printer, customer-display and
  slideshow setup is kept, so a reinstall on the same PC does not need it redone.)
  An update is not affected by this — a counter simply carries on as before.
- The "start automatically with Windows" entry is now swept properly on uninstall, so
  a removed counter no longer leaves a dangling startup item behind.

## Putting AbeerSuite on a counter

- After setup finishes, AbeerSuite now starts straight into the tray instead of
  opening a window — the counter is ready (database up, sync running) with nothing on
  screen until someone needs it, matching how it behaves every day after.
- The "start automatically with Windows" setting now keeps re-checking itself every
  time the app starts, instead of only being set once. If it was ever cleared by a
  Windows reset, a cleanup tool, or a reinstall, it now puts itself back — unless you
  had switched it off yourself from AbeerSuite's own tray menu, which is always
  respected.
- Fixed a rare cause of setup or a silent update hanging with nothing on screen: if
  the Visual C++ runtime AbeerSuite depends on was missing or damaged, the check now
  looks at the actual files instead of just a Windows setting that could be wrong, and
  a silent background update no longer waits forever for a click that nobody is there
  to give.

## Updating a counter

- No action needed — updates continue to apply automatically as before.
