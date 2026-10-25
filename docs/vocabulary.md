# Project Vocabulary

> The single source of truth for the words we use across the app. One fixed meaning per term so conversations and code stay unambiguous. Reference only — status lives in `PROJECT_BRAIN.md`.

This file unifies what used to be two separate glossaries — the Transaction Engine layer and the Work Inbox / workflow layer — into one flat list, so agents and humans use the same words during development and don't talk past each other.

---

> Words for the accounting / voucher / stock-movement layer.

**Status note (2026-06-25):** the vocabulary below is **adopted**, but the **code has not been renamed yet** — the live Prisma models are still `Voucher` / `InvVoucher` and the bridge is still `postInvVoucherToGl`. Use these terms in discussion and new design; see the "Current code ↔ vocabulary" map before grepping. The rename + the Transaction Engine itself are a planned, phased migration (see `PROJECT_BRAIN.md`).

## Transaction

**Definition:** The umbrella term for any business event the books must record. Every transaction has a **money side** (it must be expressible as balanced debit/credit). Two kinds exist — see below.

---

## Financial transaction

**Definition:** A pure money movement — balanced debit/credit lines, no stock. The **GL spine**: every transaction's money side either _is_ a financial transaction or _generates_ one. Kinds: Payment, Receipt, Contra, Journal, Credit Note, Debit Note.

**It is the subledger→GL base** — money-only documents (payment/receipt/contra/journal) are financial transactions directly.

**Current code:** the `Voucher` table (`prisma/schema/finance.prisma`), `VoucherType` enum.

---

## Inventory transaction

**Definition:** A stock movement that _also_ has a money side. It writes the **stock arm** (quantity, `InvStockLedger`) **and generates a financial transaction** for its GL effect. Kinds: Sale, Purchase, POS, GRN, Challan, Branch Transfer, Manufacturing Journal, Physical Stock, Rejection In/Out, Sales/Purchase Order.

**It is a superset of a financial transaction** — never merge stock/GST/product lines _into_ the financial transaction; the inventory transaction owns those and delegates money downward.

**Current code:** the `InvVoucher` table (`prisma/schema/inventory.prisma`), `InvVoucherType` enum.

---

## Transaction Engine

**Definition:** The single entry point + writer for all transactions. Given a normalized spec, it dispatches:

- **money-only input** → writes one financial transaction (and posts it).
- **stock-bearing input** → writes the inventory transaction's stock arm **and** emits its financial transaction, atomically, in the same DB transaction.

**One engine, one branch rule, one money-posting path.** Replaces today's scattered creators (6 hand-rolled `tx.voucher.create` call sites + the parallel `postInvVoucherToGl` bridge).

**Principle:** there must be exactly **one** path from any transaction to the General Ledger — through the financial transaction. Inventory's money side flows _through_ the spine, not around it via a separate bridge.

**Current code:** does **not exist yet** — money posting is currently split between each route's inline mirror-JE logic and `postInvVoucherToGl`. The engine is the planned consolidation.

---

## General Ledger (GL)

**Definition:** The posted truth — `JournalEntry` + `JournalLine`. Every financial transaction posts here. Branch is recorded as `JournalLine.branchId` (a per-line tag), not on the transaction header.

---

## Voucher lines

**Definition:** A voucher has exactly **two** kinds of line — the **money face** and the **goods face**:

| Term | Meaning | Current code |
| --- | --- | --- |
| **VoucherGlLine** | the **accounting** lines — every Dr/Cr posting against a ledger account: the body (sales/purchase), tax, the tender/cash legs, charges, round-off, discount, shipping | `VoucherGlLine` (`finance.prisma`) |
| **VoucherInventoryLine** | the **goods** lines — product, qty, rate, tax %, free qty, MRP (what was bought/sold) | `InvVoucherLine` (`inventory.prisma`) |

**Tenders and charges are NOT separate line types — they are `VoucherGlLine` rows.** A tender (cash/card/UPI received) is just a `Dr` against a cash/bank/AR account; a charge (freight/packing) is just a `Dr`/`Cr` against a charge ledger. Both fold into `VoucherGlLine`, distinguished by a **`role`** tag (`BODY` / `TAX` / `TENDER` / `CHARGE` / `ROUND_OFF` / `DISCOUNT` / `SHIPPING`). Tender-only attributes — `method` (CASH/CARD/UPI label) and `reference` (UPI ref / cheque #) — ride as nullable columns on the GL line. _Why they're separate tables today:_ `InvVoucher` doesn't store GL lines — the GL is computed at post time, so `InvVoucherTender`/`InvVoucherCharge` are input rows that `buildInvVoucherGlLines` derives the JournalLines from. Once the voucher **stores** its GL lines, those input rows simply **are** the GL lines (role-tagged); the separate tables go away.

**Input vs derived (keep distinct):** `VoucherInventoryLine` stays its own table because it is **not** a GL posting — it's the goods detail the body/tax `VoucherGlLine`s are *derived from* ("5 × Widget @ ₹100"). The derived **ledgers** are not voucher lines: `InvStockLedger` is the stock-arm movement ("−5 Widget, branch HQ") — do **not** name it `VoucherStockLine`; and `JournalLine` / `Account.balance` are the GL footprint of the `VoucherGlLine`s.

**Status:** naming **adopted (2026-06-27)**. `VoucherGlLine` already uses it. The `InvVoucherLine` rename and the `InvVoucherTender` / `InvVoucherCharge` → role-tagged `VoucherGlLine` fold are applied **as part of the universal-voucher table build** (when `InvVoucher` collapses into the universal voucher), not as a standalone rename.

---

## Voucher No · Universal Voucher No

**Definition:** Every voucher carries **two distinct numbers** — keep them separate.

| Term | Meaning | Series | Current code |
| --- | --- | --- | --- |
| **Voucher No** | the user-facing document number each *kind* gets from its **own** series — prefix + running sequence (+ optional suffix): `SV-2026-0001` (sale), `PMT-2026-0001` (payment), `POS-2026-0001` (counter sale), `CV-…` (contra)… What staff/customers see and print. | per voucher-kind | `UniversalVoucher.friendlyRef` → renaming to **`voucherNo`** |
| **Universal Voucher No (UVNo)** | the **single global identifier across every voucher of every kind** — the spine's `UniversalVoucher.id` IS it (no separate column). Display label **`UV-<id>`** (e.g. `UV-42`) via `formatUvNo()`. | one global (the row id) | `UniversalVoucher.id` + `formatUvNo()` (src/shared/lib/accountancy/uvNo.ts) |

**Rule:** every voucher (spine row) holds **both** — a sale is Voucher No `SV-2026-0001` *and* Universal Voucher No `UV-42`. The Voucher No is a per-kind string column; the UVNo is just the row id with a label.

**UVNo uses the `UV-` label, never `GL-`.** The spine is the **universal voucher**, not a GL-only artifact — it spans inventory-only and every other kind, so `GL-` (General Ledger) was wrong. There is **no number column** — the `id` already uniquely identifies the row, so a separate string (the old `GL_POSTING`/`reference`) was unnecessary and was dropped.

**"reference" is NOT a number.** The word *reference* is now free for a future column holding actual cross-references (e.g. "this voucher refers to bill X / PO Y") — descriptive links, not a sequence.

**Status:** **DONE (2026-06-28).** `friendlyRef`→`voucherNo` (commit `4a5261c0`); `UniversalVoucher.reference` dropped, `id`+`formatUvNo()` is the UVNo (commit `2071dc64`). Display readers show `voucherNo ?? formatUvNo(id)`. The dead `GL_POSTING` VoucherSeries is now orphaned (nothing mints it) — optional cleanup.

---

> Words for the Work / Work Inbox / ticket-workflow layer.

## Cached balance · Computed balance

**Definition:** Two ways to answer "what is this account's balance", and the rule for choosing.

| Term | What it is | Read it with |
| --- | --- | --- |
| **Cached balance** | Retired 2026-10-26 — the `Account.balance` column is dropped. | — |
| **Computed balance** | Summed from the account's own `VoucherGlLine` rows, plus its master opening. The ledger is the truth; this is that truth. | `closingForAccounts` (bounded), `aggregateClosingAsOf` (all) |

**The rule — every account balance is computed.** (Until 2026-10-26 the whole-chart surfaces read a cache; it is gone.)

Every counter carries a full local replica, so summing a known handful of accounts is an indexed local read. Measured on the 2026-09-20 copy (3,835 accounts, 13,974 GL lines): one account 2ms, a 50-party page 3ms, every party account 46ms, the whole ledger 86ms. At those numbers a figure that *cannot drift* beats a figure that is marginally cheaper, so anything that shows or decides money computes:

- the sale's credit gate (`checkCreditLimit`)
- the POS customer panel (`account-snapshot`)
- the Contacts party lists (`/api/person`, `/api/companies`)
- the party-delete guard (`deleteParty`)
- every till figure (`tillBalancesPaise`, which got there first)

**Consequence:** an account balance cannot drift. `pnpm recompute:caches` reports and repairs the three running totals still cached (`InvProduct.stock`, `InvProductBranch.stock`, `GiftCard.balance`).

**Not covered by this rule:** stock and gift-card totals stay cached. They are read per keystroke on POS and per row on product lists, where computing would be a query-per-item.

---

## Technician

**Definition:** The person who handles the repair ticket, moves it through stages, and hands work off to others. Works from the ticket page (`/office/repairing/tickets/[id]`).

---

## Ticket User

**Definition:** Another name for a Technician.

---

## Helper

**Definition:** The person who picks up a work item from the Work Inbox and performs the actual task, such as calling a customer, finding information, or sourcing parts. Works from the Work Inbox (`/office/work-flow-inbox`).

---

## Staff

**Definition:** A person who works here. Staff = `User` + HR rows — there is no separate employee record. The person who signs in, holds a seat and opens a shift is the person HR & People keeps a record of (`StaffProfile`, `StaffSalary`). A helper who never logs in still gets a User row.

---

## Seat

**Definition:** A `Position` in the org chart — a named slot a person is appointed to (`UserPosition`). "Every seat under the name, with where it sits" is the line on the counter sign-in card and on the HR profile header.

---

## Staff ledger · Salary Payable

**Definition:** Every staff member's own ledger, under the **Salary Payable** group (LIABILITY, Current Liabilities), opened the first time their HR profile is saved. Salary accrues INTO it (a later payroll journal), advances and salary payments go OUT of it (ordinary Payment vouchers), so its balance always reads "owed to them" (Cr) or "advance outstanding" (Dr). It cannot be deleted from the chart of accounts, even while empty — the Ledgers page tags it **Staff** and locks Delete, and the server refuses it, because a draft payroll run has already frozen its id. Not to be confused with the **salary expense ledger** — one org-wide `Salary & Wages`, the Dr side of every payroll run, held on the run and not on the person (the old per-person ones like `Naba Salary` are legacy, left as they were).

## Commission head · Override

**Definition:** A **commission head** (`CommissionHead`, `commission_heads`) is one named way of earning on a person's own sales — a share of every sale, a share of sales above a monthly target, slabs (direct match: the slab the sales land in sets the rate on the whole amount), a flat bonus at a target, or a **manual count** of things the app cannot see (new customers, social work) that HR types in as **entries** (`CommissionEntry`: who, head, date, count, note) against a unit, a monthly target count, pay per unit and/or a bonus at the target — globally on or off, and for every role or only some (`appliesTo`, UserRole labels). Not tied to a person. An **override** (`CommissionOverride`) is one person's say over one head: their own rate or bonus in place of the head's, or the head off for them. A person is judged by every head that is on, reaches their role and is not off for them, all paid together. **Whose sale** is the voucher's creator — the person who rang the bill. Set on **HR & People → Targets & Commission** (Set commission = the catalogue, Per person = overrides and the leaderboard); the person watches their own month on **My Portal (`/office/me`) → Pay → Target**; payroll pays what the period earned as a "Commission" line and freezes the working head by head onto the line, which the salary slip prints. The arithmetic lives once, in `shared/lib/hr/commissionScheme.ts`.

---

## Product group (office) · Category (shop)

**Definition:** One and the same grouping of products, called by two names on purpose. The office says **group** (`InvProductGroup`, `InvProduct.groupId`) because the accountancy side follows the **Tally standard** — stock groups, and **GST / HSN are set group-wise** (a product inherits its tax from its group chain). The shop says **category** because that is the word the e-commerce world uses and customers understand at once.

**In code:** the shop's `category` is `InvProduct.shopCategory` when an explicit one is set, else the group's name (`invProductToPublic` for the storefront, `invProductToAdmin` in [productAdmin.ts](../src/modules/ecommerce/lib/productAdmin.ts) for the admin list and the product form). So a product with no `shopCategory` shows its group as its shop category. Since 2026-10-25 the shop product form no longer has a free-text box: it edits the product's Group (and Brand) directly, and saving clears `shopCategory`. The old behaviour — the form copying the group name into `shopCategory` — froze stale categories when the group later changed (14 such mismatches on the demo DB), so it was retired by owner's decision. Do not rename either side to match the other.

---

### Data Flow Terms

## Worker Context

**Definition:** Information shown to the Helper as read-only context while performing a work item. It is displayed but not collected from the Helper.

**Direction:** Ticket → Work Inbox

**Examples:**

- Customer phone number
- Device model
- Previous outcome result
- Most recent note
- Values collected by earlier work steps

---

## Outcome

**Definition:** Information entered by the Helper when completing a work item. These are the answers to the work's questions.

**Direction:** Work Inbox → Ticket

**Includes:**

- Success/Unsuccess result
- Collected key-value data
- Completion notes

---

### Worker Context Sources

## Ticket Fields

**Definition:** Information taken directly from ticket, customer, or device fields.

**Examples:**

- `customer.phone`
- `device.model`

---

## Latest

**Definition:** Information resolved from the most recent ticket logs.

**Examples:**

- `meta.prevOutcome`
- `meta.lastNote`

---

## From an Earlier Step

**Definition:** A value previously collected by another Helper and stored in `Ticket.context`, then displayed later as Worker Context.

**Format:** `context.<key>`

---

### Storage Terms

## Ticket Context (`Ticket.context`)

**Definition:** A flat JSON object stored on the ticket. It is a storage mechanism, not a user interface.

**Stores:**

- Outcome values collected from Helpers
- Child pipeline snapshots when sub-pipelines are created

**Normal Ticket Usage:**

- Outcome values only

---

## Ticket Log (`TicketLog`)

**Definition:** An append-only timeline of ticket events.

**Stores:**

- Status changes
- Worker assignments
- System events
- Technician notes
- Outcome result stamps

---

### Important Distinction

## Ticket Context vs Worker Context

### Ticket Context

**Definition:** The stored JSON data drawer (`Ticket.context`).

### Worker Context

**Definition:** The information window shown to the Helper.

### Relationship

**Definition:** Worker Context can read values from Ticket Context using `context.<key>`.

---

### Popup Terms

## Log Popup

**Definition:** A popup shown to the Technician during ticket movement or hand-off. Used to collect notes.

**Used By:** Technician

**Location:** Ticket Page

**Stores Data In:** `TicketLog`

**Collects:**

- Internal (private) notes
- Public (customer-visible) notes

---

## Outcome Popup

**Definition:** A popup shown to the Helper when completing a work item. Used to collect outcome data.

**Used By:** Helper

**Location:** Work Inbox

**Stores Data In:** `Ticket.context`

**Collects:**

- Outcome values
- Outcome notes
- Success/Unsuccess result

---

### Log Popup Settings

## transitionNote

**Definition:** A predefined public note automatically posted when entering a worker.

---

## skipNoteOnEntry

**Definition:** When enabled, no Log Popup is shown during entry.

---

## requireNoteOnEntry

**Definition:** When a Log Popup appears, the private note becomes mandatory.

---

## entryQuestion

**Definition:** Guidance text displayed at the top of the Log Popup.

---

## entryArgs

**Definition:** Reserved future field for structured technician-entered key-value data. Not currently active.

---

### Work Record Terms

## Work

**Definition:** A task definition that controls how work completion behaves.

---

## prompt

**Definition:** Guidance text shown at the top of the Outcome Popup.

---

## startLabel

**Definition:** Optional button label used to claim or start work before outcomes become available.

---

## successLabel

**Definition:** Label shown for the successful completion button.

---

## failLabel

**Definition:** Label shown for the unsuccessful completion button.

**Special Rule:** If blank, only one completion button is shown.

---

## successPopup

**Definition:** Determines whether the Success outcome opens an Outcome Popup.

---

## failPopup

**Definition:** Determines whether the Unsuccess outcome opens an Outcome Popup.

---

## args

**Definition:** The arguments configured for a Work.

**Categories:**

- Worker Context (displayed)
- Outcome (collected)

---

### Workflow Terms

## Hand-off

**Definition:** When a Technician moves work responsibility to another worker.

---

## Success Outcome

**Definition:** A completed work result indicating the task was completed successfully.

---

## Unsuccess Outcome

**Definition:** A completed work result indicating the task could not be completed successfully.

---

## Work Done Log

**Definition:** A timeline entry written when a Helper completes a work item.

**Currently Stores:**

- Result (Success/Unsuccess)
- Completion note

**Currently Missing:**

- Collected outcome key-value data

---

## Known Gaps

### Timeline Outcome Values Gap

**Definition:** Outcome key-value data is stored in `Ticket.context` but is not currently shown in the timeline.

---

### Structured Technician Context Gap

**Definition:** `entryArgs` exists in the schema but is not yet connected to the Log Popup UI. Technician input is currently limited to free-text notes.

---

# Banned / clarified terms

> Applies across every layer in this doc, not just the section it originated from.

## Voucher (the word, in prose)

**Clarification:** "Voucher" is the **printed representation** of a transaction, not the entity. In design discussion say **transaction** (financial or inventory). `Voucher` / `InvVoucher` survive only as today's _table names_ until the rename lands — don't let the table name drive the domain language.

---

## Operator (Banned Term)

**Definition:** Do not use. It is ambiguous because it can mean either Technician or Helper.

---

_Last updated: 2026-09-21 — Added "Cached balance · Computed balance": the bounded-set-computes / whole-chart-caches rule, and the surfaces that moved off `Account.balance`. Prior: 2026-06-28 — Added + IMPLEMENTED "Voucher No · Universal Voucher No (UVNo)": every voucher holds the per-kind **Voucher No** (`voucherNo`, e.g. SV-/PMT-/POS-, renamed from friendlyRef) and the global **Universal Voucher No** = the spine's `id` (label `UV-<id>` via formatUvNo; the old `reference` string was dropped — the id already identifies the row, and `GL-` wrongly implied GL-only). `reference` the word is now free for a future cross-reference column. Prior: 2026-06-27 — added the "Voucher lines" term (`VoucherGlLine` + `VoucherInventoryLine`; tenders/charges are role-tagged GL rows). 2026-06-25 — merged the transaction- and work-inbox vocabularies into one doc._

## Collection (office) = Collection (shop)

Since 2026-10-25 the office calls `InvCategory` **Collection** on every screen, the same word the shop uses. In code it stays `category` / `categoryId` / `/api/inventory/categories`. A product may sit in several collections (`InvProductCollection`, main first); `InvProduct.categoryId` is the main one and is what rules and reports read. Do not confuse with the shop's **Category**, which is the office **Group**.
