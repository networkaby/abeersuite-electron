# Work Inbox & Workflow Vocabulary

> The single source of truth for the words we use in the Work / Work Inbox / ticket-workflow layer. One fixed meaning per term so conversations and code stay unambiguous. Reference only — status lives in `PROJECT_BRAIN.md`.

## Technician

**Definition:** The person who handles the repair ticket, moves it through stages, and hands work off to others. Works from the ticket page (`/office/repairing/tickets/[id]`).

---

## Ticket User

**Definition:** Another name for a Technician.

---

## Helper

**Definition:** The person who picks up a work item from the Work Inbox and performs the actual task, such as calling a customer, finding information, or sourcing parts. Works from the Work Inbox (`/office/work-flow-inbox`).

---

## Operator (Banned Term)

**Definition:** Do not use. It is ambiguous because it can mean either Technician or Helper.

---

# Data Flow Terms

## Worker Context

**Definition:** Information shown to the Helper as read-only context while performing a work item. It is displayed but not collected from the Helper.

**Direction:** Ticket → Work Inbox

**Examples:**

* Customer phone number
* Device model
* Previous outcome result
* Most recent note
* Values collected by earlier work steps

---

## Outcome

**Definition:** Information entered by the Helper when completing a work item. These are the answers to the work's questions.

**Direction:** Work Inbox → Ticket

**Includes:**

* Success/Unsuccess result
* Collected key-value data
* Completion notes

---

# Worker Context Sources

## Ticket Fields

**Definition:** Information taken directly from ticket, customer, or device fields.

**Examples:**

* `customer.phone`
* `device.model`

---

## Latest

**Definition:** Information resolved from the most recent ticket logs.

**Examples:**

* `meta.prevOutcome`
* `meta.lastNote`

---

## From an Earlier Step

**Definition:** A value previously collected by another Helper and stored in `Ticket.context`, then displayed later as Worker Context.

**Format:** `context.<key>`

---

# Storage Terms

## Ticket Context (`Ticket.context`)

**Definition:** A flat JSON object stored on the ticket. It is a storage mechanism, not a user interface.

**Stores:**

* Outcome values collected from Helpers
* Child pipeline snapshots when sub-pipelines are created

**Normal Ticket Usage:**

* Outcome values only

---

## Ticket Log (`TicketLog`)

**Definition:** An append-only timeline of ticket events.

**Stores:**

* Status changes
* Worker assignments
* System events
* Technician notes
* Outcome result stamps

---

# Important Distinction

## Ticket Context vs Worker Context

### Ticket Context

**Definition:** The stored JSON data drawer (`Ticket.context`).

### Worker Context

**Definition:** The information window shown to the Helper.

### Relationship

**Definition:** Worker Context can read values from Ticket Context using `context.<key>`.

---

# Popup Terms

## Log Popup

**Definition:** A popup shown to the Technician during ticket movement or hand-off. Used to collect notes.

**Used By:** Technician

**Location:** Ticket Page

**Stores Data In:** `TicketLog`

**Collects:**

* Internal (private) notes
* Public (customer-visible) notes

---

## Outcome Popup

**Definition:** A popup shown to the Helper when completing a work item. Used to collect outcome data.

**Used By:** Helper

**Location:** Work Inbox

**Stores Data In:** `Ticket.context`

**Collects:**

* Outcome values
* Outcome notes
* Success/Unsuccess result

---

# Log Popup Settings

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

# Work Record Terms

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

* Worker Context (displayed)
* Outcome (collected)

---

# Workflow Terms

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

* Result (Success/Unsuccess)
* Completion note

**Currently Missing:**

* Collected outcome key-value data

---

# Known Gaps

## Timeline Outcome Values Gap

**Definition:** Outcome key-value data is stored in `Ticket.context` but is not currently shown in the timeline.

---

## Structured Technician Context Gap

**Definition:** `entryArgs` exists in the schema but is not yet connected to the Log Popup UI. Technician input is currently limited to free-text notes.

---

_Last updated: 2026-06-15 — Created. Glossary for the Work / Work Inbox / workflow layer: roles (Technician/Ticket User vs Helper; Operator banned), data-flow (Worker Context vs Outcome), worker-context sources, storage (`Ticket.context` vs `TicketLog`), popups (Log Popup vs Outcome Popup) and log-popup settings, Work record fields, workflow terms, and known gaps (timeline outcome values; dormant `entryArgs`)._
