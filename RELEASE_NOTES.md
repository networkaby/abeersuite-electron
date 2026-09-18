# v1.6.0

The big addition this version is Bank Reconciliation — bring in your bank's own statement and match it against the books, right there in the accountancy menu. Also new: make or edit a ledger without leaving whatever voucher you're filling, and the counter card now shows every position a person holds, not just one. The new bank-statement tables only add — nothing existing changes — so counters and office can update in any order.

## Bank Reconciliation — new
- Upload your bank's statement (CSV / Excel) against a ledger. The file is checked before anything is saved — wrong account, duplicate lines, and anything before the reconciled date are caught up front.
- Auto-match ties a bank line to a book entry when they fall on the same day, or on a different day when they share a reference (UTR, UPI id, cheque number, IMPS ref) — the window for this was widened from 90 days to 300.
- A same-amount pair on a different day, with nothing else in common, is no longer silently skipped — it's shown as a "possible match" you can tick yourself.
- Tick several bank lines together and the toolbar offers one itemised Payment / Receipt / Contra for the whole group, instead of booking each line on its own.
- Bank and books now sit in one merged table, sorted so a bank line and the book entry explaining it land next to each other; switch back to the old two-pane view any time.
- "Book it" now always puts the statement's own bank in the voucher — it used to sometimes pick whichever cash or bank ledger was last used instead.

## Ledgers
- Create a new ledger right from any voucher's account box — type the name and press Alt+C, or just Enter when nothing matches. Ctrl+Enter opens the ledger under your cursor to edit. Same keys as Tally.

## Counter
- The line under your name on the counter card now lists every position you hold, with its branch — not just one role.
- The sales register screen now has a working back arrow and Esc to return to office.

## Small polish
- Number fields no longer show the browser's up/down spinner arrows.
- Every date field uses the same Tally-style date box; typing a month name (e.g. "feb") in a From/To pair now fills the whole month.
