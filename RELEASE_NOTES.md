# v5.0.4 [urgent]

Every counter should restart today. This build fixes the Thermal Printer page, which was
showing a wrong update warning and losing the printer settings on the desktop app, and it
adds a proper backup you can take from the shop PC itself.

Your printer and customer display settings are kept when the app updates.

## Backup and Restore — now works on the shop PC

- **Take a backup from the app.** Settings → Backup & Restore can now save the full
  database to a file on this PC. Earlier this only worked from the office through Dropbox,
  and on a counter PC the buttons did nothing at all.
- **Restore from a file** the same way. The restore asks you to type RESTORE first, so it
  cannot happen by accident.
- Nothing has to be installed for this — the app already carries the tools it needs.

## Thermal Printer page

- **The wrong "Bridge update available" warning is gone.** The desktop app was telling
  every counter to install a bridge update that does not apply to it. The app updates
  itself; there is nothing separate to install.
- **Your printer settings load properly again.** On the desktop app the page was opening
  with empty boxes — printer IP, port and connection type all blank — and pressing Save
  wiped the real settings. Please open the page once after updating and check your printer
  is still set correctly.
- **New: the page tells you if the printer is actually connected.** It shows the printer it
  is pointed at — the IP address, COM port or Windows printer name — and whether that
  printer is answering, with the reason when it is not. It keeps checking on its own, so
  switching the printer on or pulling a cable shows up without pressing anything.
- **Company Name has been removed from this page.** The name printed on receipts comes from
  the print template (Settings → Print Templates), so every counter prints the same name.
  If a receipt shows the wrong name, fix it there.

## Customer display (DQ11)

- **Same connected / not connected line** as the printer, showing the COM port it is using.
- **Advert photos have a proper home.** The app now makes a `Pictures\shop-ads` folder on
  the shop PC and uses it for the idle slideshow — just put the advert photos in that
  folder. A **Browse** button lets you pick a different folder anywhere on the PC.
- Supported photo types: PNG, JPG, BMP, GIF and WEBP. Photos from an iPhone (.heic) must be
  saved as JPG first. Make them portrait, about 640 × 960, since the display crops the sides.

## Elsewhere

- The sidebar now says **AbeerSuite** instead of ServiceMgmt.
- The downloader skips downloading again when AbeerSuite is already installed on the PC,
  saving data and time.
