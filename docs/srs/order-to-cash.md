# SRS — Order-to-Cash (O2C) & Lead-to-Customer

> Design specification for the unified sales backbone: how a customer signal becomes a lead,
> a lead becomes an order, an order becomes a sale, and a sale is delivered and recovered —
> across every channel (counter, phone, online, B2B), without ever bypassing the accountancy engine.
>
> **This doc is reference/design only.** Build status (what's shipped / in flight / next) lives in
> [PROJECT_BRAIN.md](../../PROJECT_BRAIN.md). Module wiring lives in `docs/modules/*`. Protected
> surfaces live in [docs/completed-and-protected.md](../completed-and-protected.md).
>
> Agreed in design review on 2026-06-07.

---

## 1. Purpose & scope

Replace the per-channel, instant-only sale model with **one Order backbone** that every channel
feeds, and that splits the previously-fused steps — order, sale, delivery, recovery — into
independent, trackable stages.

In scope: lead capture, order intake from all channels, the order pipeline + its child pipelines
(delivery, recovery, return & refund), POS modes, the lead→customer lifecycle, advances, and the
carrier abstraction. Out of scope: the accountancy engine internals (reused unchanged) and the
repair-ticket workflow (separate pipeline, info-only).

## 2. Actors

- **Walk-in / counter customer** — served at POS.
- **Phone customer** — order taken by an agent.
- **Online customer** — self-service on `/shop`.
- **B2B / corporate / CRM** — contract deals, large volume, after-sales obligations.
- **Cashier** — operates POS (Sale / Order / Estimate modes).
- **Reviewer** — checks remote orders (goods undamaged, address valid).
- **Dispatch** — operates the Delivery module (carriers, own boy).
- **Back-office / accountant** — vouchers, recovery, GL (protected).

## 3. Glossary

| Term | Meaning |
|---|---|
| **Signal** | Any customer interaction carrying contact info + interest (estimate, inquiry, call, form). |
| **Raw Lead** | Bulk/external-sourced record of unknown quality, in a staging table, pre-qualification. |
| **Contact** | A qualified `Person`/`Company` (lifecycle `LEAD`/`PROSPECT`), no GL ledger yet. |
| **Customer** | A Contact who has transacted; has a GL **Account** (ledger); lifecycle `CUSTOMER`. |
| **Deal** | A tracked opportunity on the Deals pipeline (P6); the interest funnel feeding orders. |
| **Order** | The parent commercial record + pipeline (P7); reserves stock; GL-silent. |
| **Sale / Invoice** | The GL event — revenue + GST + receivable; reservation → stock-out. |
| **Recovery** | Collecting post-invoice dues (receipt voucher). |
| **Carrier** | A delivery provider: Shiprocket, DTDC, Maruti, own delivery boy, or pickup. |
| **happy** | Symbolic terminal state — order delivered + settled (or branched to return/refund). |

## 4. The O2C waterfall

```
ACQUISITION
  Bulk/social sources → RAW LEAD (staging, junk-tolerant, isolated)
                          │ dedup + qualify (junk purged here)
                          ▼
CAPTURE
  Any customer signal + info  ──►  CONTACT (Person/Company, lifecycle=LEAD, no ledger)
  (estimate · phone · online · walk-in inquiry · contact form)
                          │ "any signal → Deal" (link to open Deal, else new)
                          ▼
INTEREST
  DEAL (P6)  ── nurture ──►  converts to an Order
                          ▼
ORDER (parent pipeline P7 — the spine; reserves stock, NO GL)
   online / phone / counter-Order → New → Under Review → Confirmed …
   counter-Sale → enters at invoice (always hand-to-hand)
                          │ at Confirmed
                          ▼
SALE / INVOICE   → GL: revenue + GST + receivable; reservation → stock-out.
                   First invoice/advance: Account created, lifecycle→CUSTOMER, off lead list.
                          ▼
CHILD PIPELINES (hang under the Order, reuse the shared pipeline engine)
   ├─ DELIVERY      carrier rate-shop → select → book → track → delivered
   ├─ RECOVERY      post-invoice dues → follow-up → received → cleared      (TODO)
   └─ RETURN&REFUND failed/RTO or customer return → refund                  (TODO)
                          ▼
                       "happy"  (delivered + settled)
```

## 5. Functional requirements

- **FR-1** The system shall route orders from **all channels** (counter, phone, online, B2B) onto **one Order backbone**; channels are adapters that create orders, they do not own order logic.
- **FR-2** **Counter Sale shall always be hand-to-hand** (sell + pay + handover, instant). Deferred/delivery cases at the counter shall be handled as **Orders, identical to phone orders** — there is no "deferred counter sale" variant.
- **FR-3** POS shall be **mode-first**, mode chosen before starting on the party bar, colour-coded, each mode on a **separate page** (the existing POS Sale voucher must not be modified): **Sale / Order / Estimate**.
- **FR-4** **Estimate mode** shall strip all discounts, print the **barcode/tag (cap) price**, keep negotiation verbal, and — when a customer/party is attached — **create or link a Deal**. It reserves no stock and posts no GL.
- **FR-5** **Order** shall **reserve stock** on placement and post **no GL**. The reservation is held until the order is **invoiced** (→ real stock-out) or **cancelled** (→ released).
- **FR-6** Available-to-sell = on-hand − reserved, evaluated **per branch**. POS Sale and shop listing shall check available-to-sell.
- **FR-7** All remote orders (online, phone) shall pass a **Review** stage (goods undamaged, address valid). Counter orders are reviewed instantly. Reviewers may **edit** the order (remove/adjust unsaleable/lost items) as a normal status action. Reject → refund advance + release reservation.
- **FR-8** The **Sale/Invoice** shall be the only point (besides Recovery) that posts to the GL, via the existing posting engine unchanged.
- **FR-9** Advances shall ride the **customer Account** as receipt-on-account before invoice, adjusted at invoice (supports split payment, e.g. 30/40/30). After invoice, any outstanding amount feeds the **Recovery** pipeline.
- **FR-10** Delivery shall be a **separate module** with a **pluggable carrier abstraction** supporting **rate-shopping** (auto-best or customer-selected) and per-carrier booking/tracking; own delivery boy is a manual carrier; pickup is a no-transit carrier.
- **FR-14** The Delivery module shall include a **Rate Engine** (manual rate-card calculator) that (a) prices manual carriers (own boy, direct couriers without an API) and (b) acts as a **graceful fallback when an API carrier is unreachable** — `getRates()` tries the API and, on failure/timeout, returns a **rate-card quote flagged "estimated"** (same quote shape as API), so an order is never blocked by a dead API. If the API is also down at booking, the carrier degrades to **manual docket entry**. The Rate Engine also exposes a standalone **staff lookup** (pincode + weight → price).
- **FR-11** Lead acquisition at scale shall use a **separate `RawLead` staging table**; records are deduped + qualified before promotion into `Person`/`Company`. Downstream rules apply only from the Contact tier.
- **FR-12** A **GL Account (ledger) shall be created lazily** — only at the first financial event (advance receipt or invoice) — not eagerly at contact creation.
- **FR-13** A Person/Company with contact info but no transaction is a **Lead**; on first transaction it is **promoted to Customer**, gets an Account, and drops off the lead list.

## 6. Channels & POS modes

| Channel | Mode | Enters spine at | Flow |
|---|---|---|---|
| Counter | **Sale** | invoice (instant) | hand-to-hand, pure POS (frozen) |
| Counter | **Order** | New | **same as phone order** |
| Counter | **Estimate** | — | creates/links a Deal |
| Phone | — | New | order flow |
| Online | — | New | order flow |

POS party bar shows **Order** and **Estimate** buttons; active mode changes the bar colour.

## 7. Pipelines — parent + children

The Order pipeline (P7) is the **parent**; Delivery, Recovery, Return & Refund are **child pipelines**
hanging under it, each an instance of the shared `Pipeline`/`TicketStatus` engine. Children are
**one-to-many** under the order (one order → multiple deliveries on split/re-attempt). Children
report a coarse status up; the order rolls up a headline ("Invoiced · 1 of 2 delivered · ₹3,000 in recovery").

**P7 seeded stages today** (`bootstrap-seed.ts`): New (S42) → Under Review (S43) → Confirmed (S44)
→ Packing (S45) → Dispatched (S46) → Delivered (S47, terminal) → Cancelled (S48) / Returned (S49).
**Planned change:** slim the delivery detail (Packing/Dispatched) out of P7 and into the Delivery
module/pipeline; P7 keeps a coarse "Ready to Ship → Shipped → Delivered" reflection.

## 8. Delivery & carrier abstraction

Every option is a **Carrier**, differing only by capability:

| Carrier | Rate quote | Booking | Tracking |
|---|---|---|---|
| Shiprocket (aggregator) | live API | API → AWB | webhook/poll |
| DTDC / Maruti (direct) | API or rate card | API or manual docket | API or manual |
| Own delivery boy | rate card (zone/weight) | manual assign | manual |
| Pickup | — | — (ready for pickup) | — |

Delivery pipeline: **Rate-shop → Carrier Selected → Booked → Picked Up → In Transit → Out for
Delivery → Delivered** (+ Failed/RTO → Return & Refund). Selection is **auto** (cheapest/fastest/
preferred) or **customer-chosen** at checkout; the chosen price becomes the **shipping charge** on
the order. **Caveat:** Shiprocket already aggregates most couriers — only integrate a carrier
directly when a direct contract beats the aggregator rate.

Two distinct shipping amounts, never conflated: (1) **charged to customer** = a charge line on the
order/invoice; (2) **cost paid to carrier** = courier expense, handled by the existing
Additional-Cost allocation layer for margin and posted to a courier-expense ledger.

### 8.1 Rate Engine — manual calculator / API fallback (a section of the Delivery module, not a separate module)

Same `quote()` logic serves two uses: pricing **manual carriers** (own boy, no-API couriers) and
**falling back when an API carrier is down** — so the rate-shop and order flow never block on a dead API.

```
DELIVERY module
 ├─ Carrier abstraction        getRates() / book() / track()
 │     └─ API carriers ──(on failure)──► falls back to ▼
 ├─ RATE ENGINE
 │     ├─ Rate Cards (data)    per carrier: zone matrix × weight slabs + COD/surcharge
 │     ├─ Zone resolver        origin branch + dest pincode → zone
 │     └─ quote(shipment)      → { carrier, price, eta, source: "API" | "RATE_CARD" }
 └─ UI
       ├─ Rate Cards admin     maintain matrices
       └─ Rate Calculator      staff lookup: pincode + weight → price
```

- **Inputs:** origin branch → destination pincode/local-zone, **weight** (max of actual vs volumetric), mode (surface/express), COD flag.
- **Rate card:** per carrier, a **zone × weight-slab** matrix (base + per-kg over slab) + COD charge + surcharge. Own boy = **local zones** (by area/distance); couriers = standard bands (intra-city / intra-state / metro / rest-of-India / special).
- **Output shape matches API quotes** so rate-shopping compares manual and live side-by-side; a fallback quote is **flagged "estimated"** (not a live-booked rate).
- **Degradation chain:** API live quote → (API down) rate-card estimate → (API still down at booking) **manual docket entry** → manual tracking. Mirrors own-boy's manual path end-to-end.
- The card holds **cost-to-carrier**; the **charge-to-customer** is derived by markup/free-delivery policy (the two-numbers rule above).

**v1 simplifications (proposed — confirm):** maintain Rate Cards under **Settings → Delivery** (matches the existing settings pattern); for v1 keep zones simple — **own-boy local zones + flat/manual rate entry for couriers** — and add full pincode→zone serviceability matrices later (real upkeep).

## 9. Lead funnel — three tiers

```
RAW LEAD (staging)  ──qualify+dedup──►  CONTACT (Person/Company, LEAD)  ──1st txn──►  CUSTOMER (+Account)
  bulk, junk-tolerant,                    "signal → Deal" applies here              transacts, has ledger
  isolated, source-tagged                 onward
  reject→purge
```

`RawLead` is cheap and denormalized (`name? / phone? / email? / source / campaign / rawJson /
status NEW·QUALIFIED·REJECTED / dedupKey`). Only qualified rows graduate. The "signal → Deal" and
"account-on-first-transaction" rules apply **only from the Contact tier**, never to raw staging.

## 10. Money / voucher-trigger table

| Stage | Voucher | GL? | Stock | Customer account |
|---|---|---|---|---|
| Order placed | — | No | reserve | — |
| Advance paid (pre-invoice) | Receipt | Yes | — | credit (advance) |
| Sale / Invoice | Sale (InvVoucher) | Yes — revenue + GST + receivable | reservation → stock-out | debit |
| Delivery | Challan / transit copy | No | — | — |
| Recovery | Receipt | Yes — cash/bank up, receivable down | — | credit |
| Reject / Return | Payment (refund) / Credit Note | Yes | release / stock-in | adjust |

## 11. Invariants (non-negotiable)

1. **Accountancy is protected** — only Sale and Recovery touch the GL; Order, Estimate, Delivery, and reservation are GL-silent. The posting engine (`postInvVoucherToGl`, `effectiveLedgerBalance`, etc.) is reused unchanged.
2. **One pipeline engine** — Order parent + child pipelines reuse the shared engine; no new framework.
3. **Single `InvProduct`** for all channels.
4. **POS Sale voucher is frozen** — new modes live on separate pages.
5. **Lazy ledgers** — Accounts only for parties who transact.
6. **Advances on the customer account** — no premature revenue; netted at invoice (default presentation: netted within Sundry Debtors; optional future regroup to "Advance from Customers").
7. **Still one deployable app** — monorepo split deferred.

## 12. Deferred / out of scope (v1)

- Recovery and Return & Refund pipelines (TODO — spec'd here, build later).
- `RawLead` staging tier (build when bulk sourcing actually begins; hand-entered leads use the Contact tier directly).
- Direct carrier integrations beyond Shiprocket + own boy.
- Payment gateways for online (parked; COD-first).
- Reviewer role-gating (any user can advance Review for now).
- Bifurcated "Advance from Customers" BS presentation.

---

_Design review: 2026-06-07. Supersedes the per-channel/instant-only order model._
