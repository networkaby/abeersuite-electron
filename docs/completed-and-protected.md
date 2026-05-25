# Completed and protected surfaces

Treat everything listed here as **preserve-first**. Refactors and styling are fine; behaviour or output changes require explicit user approval. If a protected surface is intentionally changed, update this file in the same commit.

## Completed list

- **Accountancy** — voucher engines (Sale, Purchase, Receipt, Payment, Contra, Journal Voucher, returns, GL postings), Day Book, Trial Balance, Balance Sheet, P&L, Receivables/Payables (bill-wise), Cash/Bank Book, Ratios, GST hub + HSN classification, ledger outstandings. Don't touch math paths (`effectiveLedgerBalance`, `aggregateClosingAsOf`, `aggregateRange`, `netProfitLoss`) without an explicit accounting task. See [docs/modules/accountancy.md](modules/accountancy.md).
- **POS** — counter-based tills, shift lifecycle (open → sales → close with variance), tax-inclusive pricing default, thermal ESC/POS receipt printing, payment splits. **Pending:** POS return flow (sale-return voucher + receipt print page + multi-partial-return guard). See [docs/modules/pos.md](modules/pos.md).
- **Inventory** — unified `InvProduct` master (shop + warehouse + POS + repair), attribute masters + `attrsJson`, multi-branch stock, GST/HSN cascade (product → group → org → null), Branch Transfer, Manufacturing Journals, Physical Stock, Bill of Materials, voucher top-bar/action-bar UX. See [docs/modules/inventory.md](modules/inventory.md).
- **Admin** — branches, departments, posts, org-chart, RBAC permission matrix (`area:operation:scope`), in-section nav (`AdminNav`), dummy-org seeding. See [docs/modules/admin.md](modules/admin.md).
- **Settings** — pipelines, statuses, sub-statuses, org-defaults, year-ending, naming-convention, printer-settings, in-section nav (`SettingsNav`). See [docs/modules/settings.md](modules/settings.md).
