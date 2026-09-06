# v1.0.2

A setup-and-update release. Nothing about billing, stock, or reports changes — every
screen works exactly as it did in 1.0.1. What changes is how AbeerSuite installs on a
counter PC and how it takes its updates afterwards.

There is no database change in this version, so your office server needs nothing done to
it before counters take this build. Install it when convenient; there is no hurry.

## Putting AbeerSuite on a counter

- Setup now tells you what it is doing at each step, instead of showing a progress bar
  that sits still and looks stuck. It opens on a short welcome screen — click Next.
- Setup now checks the free space on the drive before it starts. AbeerSuite needs about
  1.9 GB free, because Windows unpacks the app first and then copies it into place. On a
  counter with a full C: drive, setup now stops and tells you to free some space, instead
  of failing half way with a message nobody could act on.
- **A blue Windows permission box may come up during setup.** It says "Windows
  PowerShell" and does not mention AbeerSuite anywhere — that is normal, and it is not a
  virus. Click Yes. It is asking permission for the two things below. If somebody clicks
  No, AbeerSuite still installs and still runs, only slower.
- AbeerSuite now adds its own Windows Firewall rule properly. Until now that rule was
  never really being created, so Windows used to pop its own "Allow AbeerSuite to
  communicate on these networks?" alert the first time the counter started — and on any
  counter where somebody clicked Cancel, opening that counter from another PC on the shop
  network quietly stopped working. From this build the rule goes in correctly.
- AbeerSuite also asks Windows Defender to skip scanning its own program folder and its
  update folder. This is the main reason installing and updating are now much faster. We
  are saying it plainly because it is a change to the PC's virus protection. Removing
  AbeerSuite removes both entries again.

## Updating a counter

- The update download is smaller than before. A large part of what used to be sent to
  every counter was never used by it, and that has been taken out of the package.
- An update never stops to ask for permission. The firewall and Defender settings
  above need an administrator's "Yes", and there is nobody sitting at the counter when
  it updates at night — so an update quietly skips them and carries on. That means a
  counter which reaches this version by updating keeps working exactly as before, but
  gets the faster install and the firewall rule only the next time somebody installs
  AbeerSuite on it by hand.
- **From the next update onwards**, a counter taking an update will show a small
  "Updating AbeerSuite — please wait" window with a moving bar, and that window closes by
  itself once the counter comes back up. It cannot show up on this update, because it is
  the version already running that has to put it on the screen, and 1.0.1 does not know
  how. So this one update still looks the way updates always looked — the counter goes
  blank for a few minutes. Please do not switch the PC off during it.
