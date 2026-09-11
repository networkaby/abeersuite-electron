/**
 * Read Vyapar's masters out of a `.vyb` and normalise them into the shapes the
 * AbeerSuite importers expect. Pure Vyapar-side work — no database, no network,
 * so it can be developed and tested before the target DB exists.
 *
 * The rule that governs everything here (see the migration plan): AbeerSuite
 * already holds the GOOD master data — months of hand corrections to names,
 * categories, groups, brands, HSN. Vyapar is wanted for FIGURES and for rows we
 * do not have yet. So this extractor carries quantities, rates and balances
 * faithfully, and carries descriptive fields only for rows it believes are NEW.
 * Deciding new-vs-existing needs the database, so that is the resolver's job —
 * this file only prepares the evidence.
 */

import type { DatabaseSync } from "node:sqlite";

// ── Products ────────────────────────────────────────────────────────────────

/** Vyapar's `kb_items.item_type`, confirmed against this client's data. */
export const ITEM_TYPE = { PRODUCT: 1, SERVICE_A: 2, SERVICE: 3, FIXED_ASSET: 5 } as const;

/** What we decided to do with a Vyapar item, and why — the "why" is reported, never silent. */
export type ItemDisposition =
    | "migrate"      // ordinary stock item → match-or-create
    | "fixed-asset"  // item_type 5 — office equipment, belongs on the balance sheet, NOT in stock
    | "service"      // item_type 2/3 — no stock, carries negative qty by design
    | "skip-empty";  // no barcode AND no quantity — nothing of value to carry

export type VyaparItem = {
    itemId: number;
    name: string;
    code: string | null;          // Vyapar's `item_code` — a BARCODE, not an SKU
    codeKind: "EAN" | "UPC" | "BARCODE" | null;
    /** True when the code happens to match our own SKU shape and could BE the SKU. */
    codeIsOurSkuShape: boolean;
    itemType: number;
    qty: number;
    stockValue: number;
    salePrice: number | null;
    purchasePrice: number | null;
    mrp: number | null;
    hsn: string | null;
    disposition: ItemDisposition;
    note: string | null;
};

/**
 * Classify a Vyapar `item_code`. Vyapar stores manufacturer barcodes here, not
 * internal SKUs — 13 digits is EAN-13, 12 is UPC-A. Length is the only signal
 * available and it is a reliable one for retail codes.
 */
export function classifyCode(code: string | null): { value: string | null; kind: VyaparItem["codeKind"]; ourSkuShape: boolean } {
    const v = (code ?? "").trim();
    if (!v) return { value: null, kind: null, ourSkuShape: false };
    const digits = /^\d+$/.test(v);
    const kind = digits && v.length === 13 ? "EAN" : digits && v.length === 12 ? "UPC" : "BARCODE";
    // `generateSku()` (src/modules/inventory/lib/sku.ts) mints a random 6-digit
    // number, so a 6-digit Vyapar code is indistinguishable from one of ours and
    // may be adopted as the SKU directly — the resolver still checks it is free.
    return { value: v, kind, ourSkuShape: digits && v.length === 6 };
}

export function extractItems(db: DatabaseSync): VyaparItem[] {
    const rows = db.prepare(`
        select item_id, item_name, item_code, item_type,
               coalesce(item_stock_quantity, 0) qty,
               coalesce(item_stock_value, 0)    val,
               item_sale_unit_price, item_purchase_unit_price, item_mrp, item_hsn_sac_code
        from kb_items
        order by item_id
    `).all() as Array<Record<string, unknown>>;

    return rows.map((r) => {
        const code = classifyCode(r.item_code as string | null);
        const qty = Number(r.qty);
        const itemType = Number(r.item_type);

        let disposition: ItemDisposition = "migrate";
        let note: string | null = null;

        if (itemType === ITEM_TYPE.FIXED_ASSET) {
            // Office equipment (ladder, cash drawer, "New Room"). Loading these as
            // sellable stock overstates both inventory and gross profit.
            disposition = "fixed-asset";
            note = "item_type=5 — belongs on the balance sheet, not in stock";
        } else if (itemType === ITEM_TYPE.SERVICE || itemType === ITEM_TYPE.SERVICE_A) {
            disposition = "service";
            note = "service item — negative stock is normal, no inventory line";
        } else if (!code.value && qty === 0) {
            // The owner's rule: a barcode-less item with nothing on the shelf has
            // nothing worth carrying across.
            disposition = "skip-empty";
            note = "no barcode and no quantity";
        } else if (qty < 0) {
            // Negative stock is NOT a reason to drop a product. In a real shop it
            // just means goods went out before the purchase was keyed in — the
            // item is genuine and still selling. It migrates with its true (negative)
            // quantity and is listed for the physical count that follows go-live.
            note = `negative stock (${qty}) — sold before purchase was recorded; correct at the physical count`;
        }

        return {
            itemId: Number(r.item_id),
            name: String(r.item_name ?? "").trim(),
            code: code.value,
            codeKind: code.kind,
            codeIsOurSkuShape: code.ourSkuShape,
            itemType,
            qty,
            stockValue: Number(r.val),
            salePrice: num(r.item_sale_unit_price),
            purchasePrice: num(r.item_purchase_unit_price),
            mrp: num(r.item_mrp),
            hsn: str(r.item_hsn_sac_code),
            disposition,
            note,
        };
    });
}

// ── Parties ─────────────────────────────────────────────────────────────────

export const NAME_TYPE = { PARTY: 1, EXPENSE_HEAD: 2, OTHER: 3 } as const;

export type VyaparParty = {
    nameId: number;
    name: string;
    kind: "person" | "company";
    phone: string | null;          // normalised to 10 digits, or null when unusable
    rawPhone: string | null;       // what Vyapar held, kept for the run report
    email: string | null;
    address: string | null;
    gstin: string | null;
    stateCode: string | null;
    balance: number;               // signed: > 0 receivable, < 0 payable
    creditLimit: number | null;
    txnCount: number;
    include: boolean;
    reason: string;
};

/**
 * Indian mobile numbers are 10 digits. Vyapar's column is free text, so it holds
 * 9-digit numbers (a digit dropped) and 11-digit ones that are NOT 91-prefixed
 * (a digit added) — typos, not formats. A `91`/`0` prefix is a format and is
 * stripped; anything else that is not 10 digits is unusable and treated as absent.
 *
 * Inventing a replacement is not an option: `Phone.phone` is globally unique so a
 * shared placeholder collides, and a made-up number can belong to a real stranger.
 */
export function normalisePhone(raw: string | null): string | null {
    const d = (raw ?? "").replace(/\D/g, "");
    if (d.length === 10) return d;
    if (d.length === 12 && d.startsWith("91")) return d.slice(2);
    if (d.length === 11 && d.startsWith("0")) return d.slice(1);
    return null;
}

export function extractParties(db: DatabaseSync): VyaparParty[] {
    // Vyapar ships its tables with NO secondary indexes — `kb_transactions` has
    // none at all. So a correlated `(select count(*) … where txn_name_id = …)`
    // costs a full table scan PER PARTY: 3,800 × 23,551 ≈ 89 million row visits,
    // which hangs for minutes. One grouped pass plus a Map is the same answer in
    // a single scan. Any per-row lookup into a Vyapar table needs this treatment.
    const txnCounts = new Map<number, number>();
    for (const r of db.prepare(`
        select txn_name_id id, count(*) n from kb_transactions
        where txn_name_id is not null group by txn_name_id
    `).all() as Array<Record<string, unknown>>) {
        txnCounts.set(Number(r.id), Number(r.n));
    }

    const rows = db.prepare(`
        select n.name_id, n.full_name, n.phone_number, n.email, n.address,
               n.name_gstin_number, n.name_state, n.name_customer_type,
               coalesce(n.amount, 0) amount, n.credit_limit
        from kb_names n
        where n.name_type = ${NAME_TYPE.PARTY}
        order by n.name_id
    `).all() as Array<Record<string, unknown>>;

    return rows.map((r) => {
        const rawPhone = str(r.phone_number);
        const phone = normalisePhone(rawPhone);
        const gstin = str(r.name_gstin_number);
        const balance = Number(r.amount);
        const txnCount = txnCounts.get(Number(r.name_id)) ?? 0;

        // Why a party is worth carrying across. Note the last clause: a party with
        // no contact, no balance and no GST but WITH transactions still needs a
        // ledger, or the voucher replay has invoices with nowhere to post. 135 of
        // this client's parties are exactly that case.
        let include = true;
        let reason = "has a usable phone";
        if (!phone) {
            if (balance !== 0) reason = "no phone, but carries a balance";
            else if (gstin) reason = "no phone, but registered under GST";
            else if (txnCount > 0) reason = `no phone, but appears on ${txnCount} transaction(s)`;
            else { include = false; reason = "no phone, no balance, no GST, no transactions"; }
        }

        return {
            nameId: Number(r.name_id),
            name: String(r.full_name ?? "").trim(),
            // Vyapar has no person/company flag; `name_customer_type = 1` marks its
            // B2B parties and 92 of those 99 carry a GSTIN, so it is a sound proxy.
            kind: Number(r.name_customer_type) === 1 || !!gstin ? "company" : "person",
            phone,
            rawPhone,
            email: str(r.email),
            address: str(r.address),
            gstin,
            stateCode: str(r.name_state),
            balance,
            creditLimit: num(r.credit_limit),
            txnCount,
            include,
            reason,
        };
    });
}

/** Vyapar's expense heads (`name_type = 2`) — these become ledgers, not parties. */
export function extractExpenseHeads(db: DatabaseSync): Array<{ nameId: number; name: string; used: number; total: number }> {
    return db.prepare(`
        select n.name_id, n.full_name,
               count(t.txn_id) used,
               round(coalesce(sum(t.txn_cash_amount + t.txn_balance_amount), 0), 2) total
        from kb_names n
        left join kb_transactions t on t.txn_category_id = n.name_id
        where n.name_type = ${NAME_TYPE.EXPENSE_HEAD}
        group by n.name_id, n.full_name
        order by total desc
    `).all().map((r) => {
        const o = r as Record<string, unknown>;
        return { nameId: Number(o.name_id), name: String(o.full_name ?? "").trim(), used: Number(o.used), total: Number(o.total) };
    });
}

/** Vyapar's cash / bank / card ledgers, with how much actually moved through each. */
export function extractPaymentLedgers(db: DatabaseSync): Array<{ id: number; name: string; used: number; total: number }> {
    return db.prepare(`
        select p.paymentType_id id, p.paymentType_name name,
               count(m.id) used, round(coalesce(sum(m.amount), 0), 2) total
        from kb_paymentTypes p
        left join txn_payment_mapping m on m.payment_id = p.paymentType_id
        group by p.paymentType_id, p.paymentType_name
        order by total desc
    `).all().map((r) => {
        const o = r as Record<string, unknown>;
        return { id: Number(o.id), name: String(o.name ?? "").trim(), used: Number(o.used), total: Number(o.total) };
    });
}

// ── helpers ─────────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
}
