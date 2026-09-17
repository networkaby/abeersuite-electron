# v1.4.0 [urgent]

This update makes the branch on a voucher compulsory in the database. **Update every counter today** — once Head Office's database carries this change, a counter still on the old version will see its sync pause rather than risk losing rows.

## Branch is now compulsory on every voucher
- Every voucher — sales, purchases, receipts, journals, shift-close, POS, orders, gift cards, all of it — now must carry the branch it was raised at. Vouchers that had none recorded, mostly old opening entries, have been set to Head Office automatically.
- Opening stock on a product can now say which branch it is lying at, so a two-branch shop no longer counts the same opening quantity twice when branch reports are added together.
- A branch that has vouchers against it can no longer be deleted — that used to quietly blank the branch on its whole history instead of being stopped.

## Billing
- A service (labour, delivery, installation — anything from the service catalogue) can now be added on any office sale or purchase voucher, on either side, the same way it is added on a POS bill. It posts to one ledger regardless of which way the trade runs.
- Editing an invoice no longer blocks you from removing its last item line.
- The Day Book and every voucher register — inventory and accounts both — now show Settled / Partial / Due against a bill, and clicking it opens the same link window the party's Transactions tab already used.
- A Journal Entry can now be deleted from the Day Book by everyone who is meant to — it was refusing everyone, including the owner.

## Accounts
- The Trial Balance now counts stock lying in the godown — it used to disagree with the Balance Sheet by exactly that amount.
- A contra ledger, such as Cash Over/Short or Sales/Purchase Returns, now correctly reduces its group instead of adding to it.
- Masters screens follow the same Dr/Cr rule as the rest of the books, and the Balance Sheet now prints Dr or Cr against every figure instead of a bare number in red.
- The unused ledger "code" field is gone from the screens — it was blank on every ledger anyone had actually created. Ledgers now sort by name.

## Customers
- A party's credit limit card now shows the auto-calculated limit alongside the manual one, so a customer who is allowed credit through the auto rule is no longer wrongly told "cash-only".

## Reports
- Stock Summary no longer claims "No active products found" the moment the page opens, before it has read anything. The Show Profit figures — Sale Value, Profit, Margin % — were also silently broken and are fixed.
- A Business Intelligence report that fails now says so, instead of a blank error.
