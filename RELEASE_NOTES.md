# AbeerSuite 1.3.1-pre.1

**This is a test build.** It is here to be tried on one machine and compared against
your current version — not to be put on the counters. The tills will not offer it as an
update; they only take builds from the live release list.

What we most want to know: **does the app feel quicker to open?**

---

## The counter now opens on a sign-in screen, not a spinner

Starting the app used to show a spinning circle for about ten seconds while the database
and the server came up. Nothing could be done in those seconds.

Now the sign-in screen itself appears the moment you double-click the icon. You can type
your email and password straight away, while the app is still starting behind it. Press
Sign in and it carries on from there.

The screen also shows:

- **Your shop name and logo**, a greeting, and today's date and time.
- **What the app is doing** — "Starting database…", "Almost there…" — on a progress bar,
  so a slow morning looks like progress instead of a hang.
- **Counter tips** that change while you wait — real shortcuts, like F2 for the customer
  box and F6 for a fresh bill.
- **A picture behind it**, and the shop's own line at the bottom.

If you were already signed in when you closed the app, it goes straight in as before —
you will not be asked to sign in again.

**You can change all of it.** The picture, the shop message, the tips, the greeting — put
your own image at `login-background.jpg` in the app's data folder and it uses that
instead.

## Receivables and Payables

- **One screen, with a search box.** Receivables and Payables now look and work the same,
  and the search covers every way you might know a party — name, phone, code.
- **Period cards** at the top switch the view instead of being only a summary.
- **Settle a bill without a popup.** Clicking a bill opens the actual receipt or payment
  voucher over the report, with that bill already ticked.
- **The figures were wrong and are now right.** A cash sale with no party involved was
  being counted as money owed. On our own data, Receivables read **₹2,05,752.61** when the
  true figure was **₹41,038.75**. Please check your Receivables against what you believe
  is really outstanding, and tell us if anything still looks off.

## Settling bill by bill

- **A party's open bills appear beside the Receipt / Payment form** as soon as you pick
  the party. Tick the bills the money is against; the amount fills as you tick, or the
  ticks fill from the amount you typed.
- **Each bill shows Total, Settled and Open**, so you can see what is left on it.
- **Auto-Link clears the oldest overdue bill first** and never undoes a tick you made
  yourself.
- **Money the party already holds with you** closes bills in the same list as money just
  received — no separate step.
- **No more "on account"** — the other side of the entry is named properly.

## Opening balances

An opening balance can now be entered as **the bills it actually was**, instead of one
lump. The screen has two tabs, both searchable, and it can tell you what converting your
existing openings would change before you do it.

## On the customer

- **An Outstanding tab** on the customer profile, and a bill can be settled from there.
- **Bank details and a UPI QR** on every party, so a customer can scan and pay.

## Receipt and Payment vouchers

Rebuilt to suit a counter: fewer steps, the payment instrument is optional, and each
party row carries its own instrument and note rather than one shared box.

## Corrections and speed

- **A voucher's money must match its goods.** That rule now lives in one place and is
  checked everywhere, instead of each screen having its own idea of it.
- **An edit that cannot rebuild its ledger is refused**, rather than saved with the
  ledger left wrong. Earlier such an edit could go through quietly.
- **The ledger dropdown no longer freezes** when you click into it on a big chart of
  accounts.
- **The app sizes itself to the counter's screen** — no more sideways scrollbar on a
  smaller monitor, and it remembers the size you set on that PC.
- **The call follow-up reminder** waits until the last call is written down before it
  appears.

---

## Trying it

Install it on **one** machine, not a live counter. Then please tell us:

1. Does it open faster than your current version — and does the waiting feel better?
2. Does signing in from the new screen work every time?
3. Do the Receivables and Payables figures match what you know to be outstanding?

If anything is wrong, your current version can be reinstalled over this one.
