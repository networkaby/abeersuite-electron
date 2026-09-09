[urgent] Receivables and Payables were reporting money nobody owed. Every counter should take this update today.

# AbeerSuite 1.3.1

**Why this one is urgent.** The Receivables report was counting cash sales — bills where
the customer paid there and then and owes nothing — as money still outstanding. On our
own data it showed **₹2,05,752.61** when the true figure was **₹41,038.75**. Anyone who
has been chasing customers from that report has been working from wrong numbers.

Your counters will prompt to restart, and will restart on their own shortly after. A bill
in progress is never interrupted — the update waits for an empty cart.

**After updating, please check Receivables against what you believe is really
outstanding, and tell us if anything still looks wrong.**

---

## Receivables and Payables

- **The figures are now read from the party's own ledger entry**, not from a tag that a
  voucher might never have carried. A cash sale has no party entry at all, so it can no
  longer appear as money owed. Payables moved too, for a separate and ordinary reason —
  a bill was settled in full while the work was going on.
- **One screen, with a search box.** Receivables and Payables now look and work the same,
  and the search covers every way you might know a party — name, phone, code.
- **Period cards** at the top switch the view instead of being only a summary.
- **Settle a bill without a popup.** Clicking a bill opens the actual receipt or payment
  voucher over the report, with that bill already ticked.

## The counter opens on a sign-in screen, not a spinner

Starting the app used to show a spinning circle for about ten seconds while the database
and the server came up. Nothing could be done in those seconds.

Now the sign-in screen appears the moment you double-click the icon. You can type your
email and password straight away, while the app is still starting behind it.

It also shows your shop name and logo, a greeting and the date, what the app is doing on
a progress bar, and counter tips that change while you wait — real shortcuts, like F2 for
the customer box and F6 for a fresh bill.

If you were already signed in when you closed the app, it goes straight in as before.

The picture, the shop message and the tips can all be changed. Put your own image at
`login-background.jpg` in the app's data folder and it uses that instead.

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
- **An edit that cannot rebuild its ledger is refused**, rather than saved with the ledger
  left wrong. Earlier such an edit could go through quietly.
- **The ledger dropdown no longer freezes** when you click into it on a big chart of
  accounts.
- **The app sizes itself to the counter's screen** — no more sideways scrollbar on a
  smaller monitor, and it remembers the size you set on that PC.
- **The call follow-up reminder** waits until the last call is written down before it
  appears.
