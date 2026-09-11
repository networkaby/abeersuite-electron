/**
 * Resolve Vyapar's ids onto AbeerSuite's — one definition, used by the replay.
 *
 * Everything downstream depends on this being right. A party that resolves to the
 * wrong Account puts someone else's invoice on a customer's ledger; a party that
 * resolves to nothing silently drops a voucher. So the rule is the same one the
 * resolver imports with, in the same order, and anything that fails to resolve is
 * REPORTED rather than skipped.
 *
 * The lookup order matters and is deliberate — strongest key first:
 *   parties   phone → real email → the deterministic placeholder → name
 *   products  barcode/SKU → name
 *   ledgers   the approved mapping file, never a guess
 */

import type { Pool } from "pg";
import { readFileSync } from "node:fs";
import { normalisePhone, sharedPhoneIds, type VyaparParty, type VyaparItem } from "./extract";

const LEDGER_MAP = "prisma/seeds/data/vyapar-ledger-map.json";

export type PartyRef = { accountId: number; name: string };

export type Maps = {
    /** Vyapar `kb_names.name_id` → our party ledger Account id. */
    party: Map<number, PartyRef>;
    /** Vyapar `kb_items.item_id` → our InvProduct id. */
    product: Map<number, number>;
    /** Vyapar `kb_paymentTypes.paymentType_id` → our Account id (cash/bank/card). */
    payment: Map<number, number>;
    /** Vyapar expense head `kb_names.name_id` → our expense Account id. */
    expenseHead: Map<number, number>;
    /** Vyapar other-income head (`name_type = 3`) → our income Account id. */
    incomeHead: Map<number, number>;
    /** Ledgers the replay posts to by name. */
    ledger: (name: string) => number;
    /** Vyapar ledgers the owner chose NOT to migrate — vouchers touching them are reported. */
    droppedPayment: Set<number>;
    droppedHead: Set<number>;
};

type LedgerMapping = {
    vyapar: string;
    kind: "expense" | "income" | "payment";
    action: "map" | "create" | "drop";
    account: string | null;
};

/** Ledgers the replay needs by name. Missing ones are a hard error, not a fallback. */
export const REQUIRED_LEDGERS = [
    "Sales A/c", "Sales Returns", "Purchase A/c", "Purchase Returns",
    "CGST", "SGST", "IGST", "Round Off", "Discount Allowed", "Income Discount Received",
    "Loyalty Points Redeemed", "Shipping Income", "Exp Freight Inward (Purchase Courier)",
    "Office Equipment",
] as const;

export async function buildMaps(
    pool: Pool,
    parties: VyaparParty[],
    items: VyaparItem[],
    vyaparPaymentNames: Map<number, string>,
    vyaparHeadNames: Map<number, string>,
    vyaparIncomeNames: Map<number, string>,
): Promise<{ maps: Maps; unresolved: string[] }> {
    const unresolved: string[] = [];

    // ── Our side, loaded once ───────────────────────────────────────────────
    const accountByName = new Map<string, number>();
    for (const r of (await pool.query(
        `select id, name from "Account" where "personId" is null and "companyId" is null`,
    )).rows) accountByName.set(String(r.name).trim().toLowerCase(), r.id);

    const partyByPhone = new Map<string, PartyRef>();
    const partyByEmail = new Map<string, PartyRef>();
    const partyByName = new Map<string, PartyRef>();
    for (const r of (await pool.query(`
        select a.id account_id, coalesce(p.name, c.name) name,
               (select array_agg(ph.phone) from "Phone" ph
                where ph."personId" = p.id or ph."companyId" = c.id) phones,
               (select array_agg(e.email) from "Email" e
                where e."personId" = p.id or e."companyId" = c.id) emails
        from "Account" a
        left join "Person"  p on p.id = a."personId"
        left join "Company" c on c.id = a."companyId"
        where (a."personId" is not null or a."companyId" is not null)
          and (p.id is null or (p."mergedIntoPersonId" is null and p."convertedToCompanyId" is null))
          and (c.id is null or (c."mergedIntoCompanyId" is null and c."convertedToPersonId" is null))
    `)).rows) {
        const ref: PartyRef = { accountId: r.account_id, name: r.name };
        for (const ph of (r.phones ?? []) as string[]) {
            const n = normalisePhone(ph);
            if (n) partyByPhone.set(n, ref);
        }
        for (const em of (r.emails ?? []) as string[]) partyByEmail.set(em.toLowerCase(), ref);
        const k = String(r.name ?? "").trim().toLowerCase();
        if (k && !partyByName.has(k)) partyByName.set(k, ref);
    }

    const prodBySku = new Map<string, number>();
    for (const r of (await pool.query(`select id, upper(sku) sku from "InvProduct"`)).rows) prodBySku.set(r.sku, r.id);
    const prodByCode = new Map<string, number>();
    for (const r of (await pool.query(`select "productId", upper(value) v from inv_product_codes`)).rows) {
        prodByCode.set(r.v, r.productId);
    }
    const prodByName = new Map<string, number>();
    for (const r of (await pool.query(`select id, name from "InvProduct"`)).rows) {
        const k = String(r.name).trim().toLowerCase();
        if (!prodByName.has(k)) prodByName.set(k, r.id);
    }

    // ── Parties ─────────────────────────────────────────────────────────────
    const party = new Map<number, PartyRef>();
    // A phone shared with an earlier party is no key at all — see sharedPhoneIds().
    const shared = sharedPhoneIds(parties);
    for (const p of parties) {
        if (!p.include) continue;
        const phone = shared.has(p.nameId) ? null : p.phone;
        const hit = (phone ? partyByPhone.get(phone) : undefined)
            ?? (p.email ? partyByEmail.get(p.email.toLowerCase()) : undefined)
            ?? partyByEmail.get(`vyapar-${p.nameId}@placeholder.invalid`)
            ?? partyByName.get(p.name.trim().toLowerCase());
        if (hit) party.set(p.nameId, hit);
        else unresolved.push(`party "${p.name}" (vyapar id ${p.nameId}) has no match`);
    }

    // ── Products ────────────────────────────────────────────────────────────
    const product = new Map<number, number>();
    for (const i of items) {
        if (i.disposition === "skip-empty") continue;
        const code = (i.code ?? "").toUpperCase();
        const hit = (code ? (prodBySku.get(code) ?? prodByCode.get(code)) : undefined)
            ?? prodByName.get(i.name.trim().toLowerCase());
        if (hit) product.set(i.itemId, hit);
        // A dead row the resolver deliberately skipped is not an error here — it is
        // only a problem if a voucher in the window actually references it, which the
        // replay checks at the point of use.
    }

    // ── Ledgers, from the approved mapping file ─────────────────────────────
    const mappings = JSON.parse(readFileSync(LEDGER_MAP, "utf8")).mappings as LedgerMapping[];
    const byVyaparName = new Map(mappings.map((m) => [m.vyapar, m]));

    const payment = new Map<number, number>();
    const droppedPayment = new Set<number>();
    for (const [id, nm] of vyaparPaymentNames) {
        const m = byVyaparName.get(nm);
        if (!m || m.action === "drop") { droppedPayment.add(id); continue; }
        const acc = m.account ? accountByName.get(m.account.trim().toLowerCase()) : undefined;
        if (acc) payment.set(id, acc);
        else unresolved.push(`payment ledger "${nm}" → "${m.account}" which does not exist`);
    }

    const expenseHead = new Map<number, number>();
    const droppedHead = new Set<number>();
    for (const [id, nm] of vyaparHeadNames) {
        const m = byVyaparName.get(nm);
        if (!m || m.action === "drop") { droppedHead.add(id); continue; }
        const acc = m.account ? accountByName.get(m.account.trim().toLowerCase()) : undefined;
        if (acc) expenseHead.set(id, acc);
        else unresolved.push(`expense head "${nm}" → "${m.account}" which does not exist`);
    }

    const incomeHead = new Map<number, number>();
    for (const [id, nm] of vyaparIncomeNames) {
        const m = byVyaparName.get(nm);
        if (!m || m.action === "drop") continue;   // idle income heads carry nothing
        const acc = m.account ? accountByName.get(m.account.trim().toLowerCase()) : undefined;
        if (acc) incomeHead.set(id, acc);
        else unresolved.push(`income head "${nm}" → "${m.account}" which does not exist`);
    }

    for (const n of REQUIRED_LEDGERS) {
        if (!accountByName.has(n.toLowerCase())) unresolved.push(`required ledger "${n}" is missing`);
    }

    const ledger = (name: string): number => {
        const id = accountByName.get(name.trim().toLowerCase());
        if (!id) throw new Error(`ledger "${name}" not found`);
        return id;
    };

    return { maps: { party, product, payment, expenseHead, incomeHead, ledger, droppedPayment, droppedHead }, unresolved };
}
