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

**Definition:** The posted truth — `JournalEntry` + `JournalLine` + `Account.balance`. Every financial transaction posts here. Branch is recorded as `JournalLine.branchId` (a per-line tag), not on the transaction header.

---

## Voucher lines

**Definition:** A voucher carries several kinds of **lines**, named `Voucher<What>Line` so the model reads as a set of siblings and is self-describing. Two are the "faces" of a voucher — the **money side** and the **goods side** — and the rest are supporting line kinds. A voucher line is **input** (what the user entered), distinct from the **derived ledgers** the engine writes from it.

| Term | Meaning | Current code |
| --- | --- | --- |
| **VoucherGlLine** | the **accounting** lines — Dr/Cr against ledger accounts (the money face) | `VoucherGlLine` (`finance.prisma`) — already follows the convention |
| **VoucherInventoryLine** | the **goods** lines — product, qty, rate, tax (the goods face) | `InvVoucherLine` (`inventory.prisma`) |
| **VoucherTenderLine** | the **payment** lines — cash / card / UPI received | `InvVoucherTender` |
| **VoucherChargeLine** | the **extra-charge** lines — freight, packing, etc. | `InvVoucherCharge` |

**Input vs derived (keep distinct):** `VoucherInventoryLine` is the item _on the voucher_ ("5 × Widget @ ₹100"). `InvStockLedger` is the stock _movement_ it produces ("−5 Widget, branch HQ") — a **derived ledger** (the stock-arm output), **not** a voucher line. Do not name the movement `VoucherStockLine`; that would blur input vs. derived. Likewise `VoucherGlLine` is the accounting input; `JournalLine` / `Account.balance` are its derived GL footprint.

**Status:** naming **adopted (2026-06-27)**. `VoucherGlLine` already uses it. The `InvVoucherLine` / `InvVoucherTender` / `InvVoucherCharge` renames are applied **as part of the universal-voucher table build** (when `InvVoucher` collapses into the universal voucher), not as a standalone rename — one migration, not two.

---

> Words for the Work / Work Inbox / ticket-workflow layer.

## Technician

**Definition:** The person who handles the repair ticket, moves it through stages, and hands work off to others. Works from the ticket page (`/office/repairing/tickets/[id]`).

---

## Ticket User

**Definition:** Another name for a Technician.

---

## Helper

**Definition:** The person who picks up a work item from the Work Inbox and performs the actual task, such as calling a customer, finding information, or sourcing parts. Works from the Work Inbox (`/office/work-flow-inbox`).

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

_Last updated: 2026-06-27 — Added the "Voucher lines" term: the `Voucher<What>Line` naming convention (VoucherGlLine / VoucherInventoryLine / VoucherTenderLine / VoucherChargeLine), the input-vs-derived-ledger distinction, and the note that the renames land with the universal-voucher table build. Prior: 2026-06-25 — merged the former transaction- and work-inbox vocabularies into this single doc._
