# v1.5.1

A counter and office fix release. The PIN sign-in screen from the last version had a broken corner or two — this puts it back the way it was meant to work, with the photo showing properly and no dead ends. The Day Book report also gets a more useful filter. No database change — safe to install in any order.

## Sign-in screen at the counter, put back together

- Fixed a few dead ends on the sign-in screen: tapping a face with no PIN set, choosing "Someone else" with nobody enrolled, and tapping the keypad before the app had finished starting could all leave the screen stuck with no way back to the photos. Every path now has a way out.
- The screen used to show your photo only right after a fresh start of the counter PC. Signing out, a PIN attempt timing out, or the app being reopened would drop you on a plain email box instead — even though your photo was sitting right there the whole time. It now shows your photo in every one of these cases.
- Your cached photo now appears instantly instead of after a delay — the live copy from the office quietly replaces it a moment later if it has changed. A photo changed in the office still reaches the till the same day, it just no longer makes the cashier wait to see a face at all.
- Fixed your position (Role-Admin, Counter Operator, etc.) sometimes showing blank under your name.
- Setting a PIN for the first time is confirmed to actually work now — a bug meant it silently could not save on a counter till before this fix.
- The two links that lead back to the photo screen ("Back to photos" / "Login with PIN") now read the same wording in both places.

## Day Book: "Unsettled only" is clearer and faster

- The filter on the Day Book report is renamed from "Unpaid only" to **"Unsettled only"** — it was never about unpaid bills specifically, it keeps every voucher that still has money open against a party, receipts and payments included.
- The filter itself is more useful now: it used to keep every Due/Partial row even when there was nothing on the party's other side to match it against, which was not actionable from this screen. It now keeps only the rows a staff member can actually do something with, and runs noticeably faster while doing it.
