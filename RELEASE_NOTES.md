# v1.3.5

A quiet update — installs itself safely when the counter is idle, on the login screen, or with an empty POS cart. Every counter and office terminal should take this release for the new unified shift closure print formats, instant shift closing, accurate cash drawer reconciliation, and voucher posting safeguards.

## Counter & POS Shift Closing

- **Shift close summary print is now fully customizable.** Shift close reports (both 80mm/58mm thermal receipts and A4 sheets) now run through the central Voucher Print Template designer. You can customize header details, show/hide sections, configure barcodes, notes, and styling from Settings.
- **Immediate closing with background print.** Closing a shift no longer blocks the cashier waiting for printer feedback. When you click Close Shift, the dialog closes immediately and triggers thermal printing in the background.
- **Convenient print toggles.** Added "Print After Save" and "Thermal" quick toggles right next to the shift close action buttons so cashiers can choose their print output on the spot.
- **Shift detail view reports.** Dedicated print buttons and formatted print previews are now available directly on the Shift Detail page in the back-office.
- **Reopen & Re-close safeguards.** Closed shifts can now be reopened safely for corrections without corrupting voucher links, while protecting against re-closing from offline counters.

## Billing & Cash Drawer Accuracy

- **Accurate till cash calculations.** Fixed cash-handling calculations during shift close to properly capture all receipts, cash movements, and cash refunds, accurately reconstructing the exact till balance at close time.
- **Clearer terminology.** Shift summary labels now plainly read "Counter opening cash" and "Counter cash flow" to eliminate confusion with bank accounts.
- **Compact 3-column layout.** The shift close dialog now organizes physical denomination counts, cash flow breakdown, and contra previews neatly on one screen without excessive scrolling.

## Accountancy & Vouchers

- **Save & Post in one step.** Added "Save & Post" action for vouchers to speed up daily bookkeeping workflows.
- **Cleaner series numbering.** Draft vouchers no longer take up series numbers prematurely; numbers advance only when the voucher is officially posted.
- **Restore cancelled vouchers.** Cancelled vouchers can now be restored (un-cancelled) directly if marked in error.
- **Strict balances.** Strengthened double-entry balance calculations to avoid sign flips across account ledgers.

## Sync & Data Integrity

- **Reconcile protection.** Counter reconciliation will never delete data that the cloud server has not yet received.
- **Posted voucher safety.** Offline counters are prevented from accidentally demoting cloud-posted vouchers back to draft state.
