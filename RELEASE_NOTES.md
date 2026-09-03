# v5.0.3

A small release that fixes counter setup on a fresh PC. Install it on any counter that got stuck on the "Counter Setup" screen after 5.0.2.

## Counter setup on a new PC

- **Setup no longer sticks at "Save and Continue".** On a clean Windows PC the local database could not start because a Microsoft runtime (Visual C++ 2015-2022) was missing. The app quietly fell back to the server, and the counter wizard could never prepare its local copy. The installer now checks for that runtime first and downloads it from Microsoft when it is absent, so a fresh PC comes up with a working local database.
- **The web setup does the same check** before it starts the installer, so whichever one you run first takes care of it once. No extra size in the installer: the runtime is only fetched when a PC actually needs it.
- **A clearer message if it still cannot start.** The app log now names the missing runtime and where to get it, instead of a bare error number.

## Build

- A developer's local web-testing settings can no longer leak into a counter or office installer. Only the desktop configuration is read when an installer is built.
