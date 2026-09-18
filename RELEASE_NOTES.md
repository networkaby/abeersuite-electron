# v1.5.0 [urgent]

A counter release. The big one is PIN sign-in at the till — tap your photo, type six digits, you are in. There is a **database change** in this version, so counters must be updated first (details at the bottom). Worth installing on every counter PC; the office side gets a clearer frame around the page.

## Sign in at the counter with a PIN

- The sign-in screen on a counter PC now shows the people who have signed in on that machine — photo, name and position. Tap your own card, type your 6-digit PIN, and you are in. No more typing a full email and password at the start of every shift.
- **Setting one is your own errand.** Press **Set PIN** under the Sign in button, sign in with your password as usual, and the card itself asks you to choose six digits before the app opens. No popup, no trip into the office screens. **Skip** is always there — a cashier who wants nothing to do with it never sees an extra step.
- Already have a PIN? The same card offers **Remove from this counter** and **Remove from all counters**.
- **A PIN belongs to one counter, not to you everywhere.** Setting it on the front till does not let anyone in on the back one. This is deliberate: if a counter PC is ever stolen, it is a key to that counter and nothing else.
- **The PIN never replaces the password.** Ten days after you last typed your password, or three days without signing in, the screen asks for the password again. Typing it resets both clocks and your PIN stays as it is. This works with the internet down too.
- A PIN works only inside the installed counter app. It is not a way into the website.
- You get exactly the same rights either way — six digits do not give more or less than your password does.

## Counters keep working while an update is rolling out

- A counter no longer sits on **"Preparing this counter"** because the office has not taken the matching office-side update yet. Previously one new table that the office did not have could hold up the whole till — billing included — for a feature nobody was even using. Now the counter notes that the table is not there yet, waits for it, and carries on with everything else.
- A table that was working and then genuinely disappears is still treated as a real problem and still stops the sync loudly. Only the "not deployed yet" case is tolerated.

## The office frame tells you where you are

- The top bar now carries the icon and name of the module you are in — Accountancy, Inventory, and so on. With the sidebar folded away there was previously nothing on screen naming the module.
- An open group in the sidebar is now marked with a guide line in that module's own colour, so a long list of children reads as one group instead of twenty loose rows.
- The colours on money figures are untouched — instant fund, cash, bank, receivable and payable still mean exactly what they meant.

## Database change — update counters first

This version adds a new table (`user_counter_pins`). Install this build on **every counter first**, and only then let the office side take its update. A counter that is left on the old version while the office moves ahead will stop syncing completely — not just the new table — and print **SCHEMA DRIFT**. The fix above means the reverse order is now safe: an updated counter simply waits for the office.
