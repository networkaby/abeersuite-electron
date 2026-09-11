import { createHash } from "crypto";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ACCOUNT_GROUPS } from "@/shared/lib/constants/accounting";
import { normaliseGstinState } from "@/shared/lib/gst/validateGstinState";
import { isValidStateCode } from "@/shared/lib/gst/indianStates";
import { reconcileOpeningSuspense } from "@/modules/accountancy/lib/openingBalance";
import { CUSTOMER_IMPORT_FIELDS, type CustomerImportField } from "./customerImportFields";

export { CUSTOMER_IMPORT_FIELDS };
export type { CustomerImportField };

/**
 * Server-side validator / writer for the customer (Person + Company) CSV
 * importer at `/office/settings/customer-import`. Mirrors the shape of the
 * product importer so the preview / commit API routes can be identical.
 *
 * Dedupe key: phone OR email. If any of the row's contacts already belong to
 * an existing Person/Company, the row is matched to that record. In `skip` mode
 * duplicates are reported and dropped; in `update` mode the existing record is
 * patched and any new contacts are appended.
 *
 * Each created row spawns a ledger Account under either Sundry Debtors (default
 * or `receivableBalance` / positive `openingBalance`) or Sundry Creditors
 * (`payableBalance` / negative `openingBalance`). Opening balance is written
 * directly to Account.openingBalance (master field — no journal posted); the
 * "Difference in Opening Balances" suspense ledger is reconciled once after
 * the batch via `reconcileOpeningSuspense()`.
 */

export interface CustomerImportRowInput {
    rowIndex: number;
    values: Partial<Record<CustomerImportField, string>>;
}

export type ImportMode = "skip" | "update";
export type CustomerKind = "person" | "company";

export interface CustomerImportRequest {
    rows: CustomerImportRowInput[];
    mode: ImportMode;
    dryRun: boolean;
}

export interface RowResult {
    rowIndex: number;
    action: "create" | "update" | "skip" | "error";
    kind: CustomerKind;
    name: string | null;
    phone: string | null;
    email: string | null;
    gstin: string | null;
    accountGroup: "Sundry Debtors" | "Sundry Creditors" | null;
    openingBalance: number | null;
    openingType: "DEBIT" | "CREDIT" | null;
    errors: string[];
}

export interface CustomerImportResult {
    willCreate: number;
    willUpdate: number;
    willSkip: number;
    errorCount: number;
    results: RowResult[];
}

const GST_REG_TYPES = ["REGULAR", "COMPOSITION", "SEZ", "UNREGISTERED"] as const;
type GstRegType = (typeof GST_REG_TYPES)[number];

function pickPhones(v: CustomerImportRowInput["values"]): string[] {
    return [v.phone1, v.phone2, v.phone3]
        .map((s) => (s ?? "").trim())
        .filter((s) => s.length > 0);
}

function pickEmails(v: CustomerImportRowInput["values"]): string[] {
    return [v.email1, v.email2, v.email3]
        .map((s) => (s ?? "").trim().toLowerCase())
        .filter((s) => s.length > 0);
}

function parseBool(raw: string | undefined): boolean | null | undefined {
    if (raw == null || raw.trim() === "") return undefined;
    const v = raw.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(v)) return true;
    if (["false", "no", "n", "0"].includes(v)) return false;
    return null;
}

function isProbablyEmail(s: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Parse a rupee amount. Returns: undefined for blank, null for invalid, signed number otherwise. */
function parseAmount(raw: string | undefined): number | null | undefined {
    if (raw == null || raw.trim() === "") return undefined;
    const cleaned = raw.replace(/[,\s₹]/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return n;
}

function parseKind(raw: string | undefined): CustomerKind | null | undefined {
    if (raw == null || raw.trim() === "") return undefined;
    const v = raw.trim().toLowerCase();
    if (["person", "individual", "consumer", "p", "i"].includes(v)) return "person";
    if (["company", "firm", "corporate", "business", "c"].includes(v)) return "company";
    return null;
}

type AccountGroupName = "Sundry Debtors" | "Sundry Creditors";

function parseGroup(raw: string | undefined): AccountGroupName | null | undefined {
    if (raw == null || raw.trim() === "") return undefined;
    const v = raw.trim().toLowerCase();
    if (["debtor", "debtors", "customer", "sundry debtors", "sundry debtor", "dr"].includes(v)) return "Sundry Debtors";
    if (["creditor", "creditors", "supplier", "vendor", "sundry creditors", "sundry creditor", "cr"].includes(v)) return "Sundry Creditors";
    return null;
}

/**
 * Stable dedupe key for a party with no phone and no email.
 *
 * Deterministic by design: the same row must yield the same address on every run,
 * so re-importing a file matches the existing party instead of creating a second
 * one. 20 hex characters of SHA-256 is ~80 bits — far past any collision risk at
 * the scale of a customer list, and short enough to stay readable in the address.
 */
function placeholderKey(name: string, gstin: string | null): string {
    const basis = `${name.trim().toLowerCase()}|${(gstin ?? "").trim().toUpperCase()}`;
    return createHash("sha256").update(basis).digest("hex").slice(0, 20);
}

/**
 * The placeholder address a contact-less row would be given, or null if the row
 * has a contact of its own.
 *
 * Derived from the RAW row values so that the existence lookup below and the
 * row-level assignment further down compute the identical address. A deterministic
 * key is only half the fix: unless the key is also SEARCHED for, the importer still
 * cannot see the party it created last time and creates it again.
 */
function placeholderFor(v: CustomerImportRowInput["values"]): string | null {
    if (pickPhones(v).length > 0 || pickEmails(v).length > 0) return null;
    return `no-contact.${placeholderKey(v.name ?? "", v.gstin ?? null)}@placeholder.invalid`;
}

export async function runCustomerImport(req: CustomerImportRequest): Promise<CustomerImportResult> {
    // ── 1. Batched existence lookup. One query each for phones and emails;
    //    track which OWNER (person vs company) each contact belongs to so the
    //    row-side check can refuse to merge a Person row into a Company match.
    const allPhones = new Set<string>();
    const allEmails = new Set<string>();
    for (const row of req.rows) {
        for (const p of pickPhones(row.values)) allPhones.add(p);
        for (const e of pickEmails(row.values)) allEmails.add(e);
        // Look up the address a contact-less row WOULD be given, so an existing
        // party created by a previous run of the same file is found and updated
        // rather than duplicated.
        const ph = placeholderFor(row.values);
        if (ph) allEmails.add(ph);
    }

    type Owner = { kind: CustomerKind; id: number };
    const phoneOwners = new Map<string, Owner>();
    const emailOwners = new Map<string, Owner>();
    if (allPhones.size > 0) {
        const rows = await prisma.phone.findMany({
            where: { phone: { in: [...allPhones] } },
            select: { phone: true, personId: true, companyId: true },
        });
        for (const r of rows) {
            if (r.personId != null) phoneOwners.set(r.phone, { kind: "person", id: r.personId });
            else if (r.companyId != null) phoneOwners.set(r.phone, { kind: "company", id: r.companyId });
        }
    }
    if (allEmails.size > 0) {
        const rows = await prisma.email.findMany({
            where: { email: { in: [...allEmails] } },
            select: { email: true, personId: true, companyId: true },
        });
        for (const r of rows) {
            if (r.personId != null) emailOwners.set(r.email, { kind: "person", id: r.personId });
            else if (r.companyId != null) emailOwners.set(r.email, { kind: "company", id: r.companyId });
        }
    }

    // In-batch collision guards.
    const phoneClaims = new Map<string, number>();
    const emailClaims = new Map<string, number>();

    const results: RowResult[] = [];
    const validRows: Array<{
        rowIndex: number;
        existingId: number | null;
        kind: CustomerKind;
        data: {
            name: string;
            address: string | null;
            agreedToTerms: boolean | null;
            gstin: string | null;
            gstStateCode: string | null;
            gstRegType: GstRegType | null;
            shippingStateCode: string | null;
            companyReg: string | null;
            taxId: string | null;
        };
        phones: string[];
        emails: string[];
        accountGroup: "Sundry Debtors" | "Sundry Creditors";
        openingBalance: number | null;
        openingType: "DEBIT" | "CREDIT" | null;
        creditLimit: number | null;
    }> = [];

    for (const row of req.rows) {
        const errors: string[] = [];
        const v = row.values;

        // Kind — defaults to person when blank or absent.
        const kindParsed = parseKind(v.kind);
        if (kindParsed === null) errors.push(`kind "${v.kind}" — expected person/individual or company/firm`);
        const kind: CustomerKind = kindParsed ?? "person";

        // Account group — defaults to Sundry Debtors when blank or absent.
        // Decoupled from the balance side: a debtor can carry a credit opening
        // (advance receipt) and a creditor can carry a debit opening (overpayment).
        const groupParsed = parseGroup(v.accountGroup);
        if (groupParsed === null) errors.push(`accountGroup "${v.accountGroup}" — expected debtor/customer or creditor/supplier`);
        const accountGroup: AccountGroupName = groupParsed ?? "Sundry Debtors";

        const name = v.name?.trim() ?? "";
        if (!name) errors.push("name is required");

        const phones = pickPhones(v);
        let emails = pickEmails(v);
        for (const e of emails) {
            if (!isProbablyEmail(e)) errors.push(`email "${e}" is not a valid address`);
        }

        // GST integrity
        const integrity = normaliseGstinState({
            gstin: v.gstin,
            gstStateCode: v.gstStateCode,
        });
        let gstin: string | null = null;
        let gstStateCode: string | null = null;
        if (!integrity.ok) {
            errors.push(integrity.error);
        } else {
            gstin = integrity.value.gstin || null;
            gstStateCode = integrity.value.gstStateCode || null;
        }

        let gstRegType: GstRegType | null = null;
        if (v.gstRegType?.trim()) {
            const t = v.gstRegType.trim().toUpperCase();
            if (!GST_REG_TYPES.includes(t as GstRegType)) {
                errors.push(`gstRegType "${v.gstRegType}" must be one of ${GST_REG_TYPES.join(", ")}`);
            } else {
                gstRegType = t as GstRegType;
            }
        } else if (gstin) {
            gstRegType = "REGULAR";
        }

        const shippingRaw = v.shippingStateCode?.trim() ?? "";
        let shippingStateCode: string | null = null;
        if (shippingRaw) {
            if (!isValidStateCode(shippingRaw)) {
                errors.push(
                    `shippingStateCode "${shippingRaw}" is not a valid 2-digit Indian state code`,
                );
            } else {
                shippingStateCode = shippingRaw;
            }
        }

        const agreed = parseBool(v.agreedToTerms);
        if (agreed === null) {
            errors.push(`agreedToTerms "${v.agreedToTerms}" — expected true/false/yes/no/1/0`);
        }

        // ── Balance resolution. Accept either (receivable+payable) OR signed
        //    openingBalance, never both. Receivable/Payable are positive
        //    magnitudes; signed openingBalance lets a single column do both.
        const receivable = parseAmount(v.receivableBalance);
        const payable = parseAmount(v.payableBalance);
        const signedOpening = parseAmount(v.openingBalance);
        if (receivable === null) errors.push(`receivableBalance "${v.receivableBalance}" is not a valid number`);
        if (payable === null) errors.push(`payableBalance "${v.payableBalance}" is not a valid number`);
        if (signedOpening === null) errors.push(`openingBalance "${v.openingBalance}" is not a valid number`);
        if ((receivable ?? 0) < 0) errors.push(`receivableBalance "${v.receivableBalance}" must be positive (use payableBalance / signed openingBalance for credit side)`);
        if ((payable ?? 0) < 0) errors.push(`payableBalance "${v.payableBalance}" must be positive`);

        const hasTwoColumn = (receivable && receivable > 0) || (payable && payable > 0);
        const hasOneColumn = signedOpening != null && signedOpening !== 0;
        if (hasTwoColumn && hasOneColumn) {
            errors.push("set either receivableBalance/payableBalance OR a signed openingBalance, not both");
        }
        if ((receivable ?? 0) > 0 && (payable ?? 0) > 0) {
            errors.push("a row can't carry both a receivable AND a payable opening balance — split into two rows or net them yourself");
        }

        // Side of the opening balance — independent of accountGroup.
        // Receivable column → DEBIT, Payable column → CREDIT (always).
        // Signed openingBalance → sign drives the side, magnitude is the amount.
        let openingBalance: number | null = null;
        let openingType: "DEBIT" | "CREDIT" | null = null;
        if (hasTwoColumn) {
            if ((receivable ?? 0) > 0) {
                openingBalance = receivable!;
                openingType = "DEBIT";
            } else if ((payable ?? 0) > 0) {
                openingBalance = payable!;
                openingType = "CREDIT";
            }
        } else if (hasOneColumn) {
            openingBalance = Math.abs(signedOpening!);
            openingType = signedOpening! >= 0 ? "DEBIT" : "CREDIT";
        }

        const creditLimit = parseAmount(v.creditLimit);
        if (creditLimit === null) errors.push(`creditLimit "${v.creditLimit}" is not a valid number`);
        if ((creditLimit ?? 0) < 0) errors.push(`creditLimit "${v.creditLimit}" must be positive`);

        // A phone or email is normally required so the customer is reachable.
        // Bulk-migrated ledger-only parties (a GST number or a carried-forward
        // balance, but no captured contact) are still worth importing — stamp a
        // placeholder email so the row has a contact key instead of being rejected.
        //
        // That key MUST be derived from the row, never random. It was `randomUUID()`
        // until 2026-09-11, on the reasoning that a unique value "can never
        // accidentally dedupe-match a different no-contact party". The opposite
        // turned out to be the problem: a random key cannot match ITSELF either, so
        // re-importing the same file creates every contact-less party again. One
        // import run on 25-Jul-2026 was executed twice and left 33 duplicate parties
        // — TEKTRONIX, M. M. Traders, RYSWARE and others each holding two unreachable
        // records — which then had to be merged by hand.
        //
        // A digest of the identifying fields makes the same row produce the same
        // address every time, so a re-run updates instead of duplicating. GSTIN is
        // included because it is what separates two businesses of similar name; where
        // there is no GSTIN, no contact and no distinguishing data at all, two rows
        // sharing a name are indistinguishable by anything we hold, and treating them
        // as one is the better failure.
        if (phones.length === 0 && emails.length === 0) {
            if (gstin || openingBalance != null) {
                emails = [placeholderFor(v)!];
            } else {
                errors.push("at least one phone or email is required (or a GST number / opening balance)");
            }
        }

        // In-batch dedupe — flag a row claiming a contact that an earlier row already claimed.
        for (const p of phones) {
            const prior = phoneClaims.get(p);
            if (prior != null) errors.push(`phone "${p}" is also on row ${prior + 2} (duplicate within this file)`);
        }
        for (const e of emails) {
            const prior = emailClaims.get(e);
            if (prior != null) errors.push(`email "${e}" is also on row ${prior + 2} (duplicate within this file)`);
        }

        // Match an existing record by phone-or-email. Refuse to silently convert
        // Person ↔ Company — that's almost always a data-entry mistake.
        let existing: Owner | null = null;
        for (const p of phones) {
            const o = phoneOwners.get(p);
            if (o) { existing = o; break; }
        }
        if (existing == null) {
            for (const e of emails) {
                const o = emailOwners.get(e);
                if (o) { existing = o; break; }
            }
        }
        if (existing && existing.kind !== kind) {
            errors.push(`row's kind is "${kind}" but matched contact already belongs to a ${existing.kind} — fix the row's kind or use different contacts`);
        }

        if (errors.length > 0) {
            results.push({
                rowIndex: row.rowIndex,
                action: "error",
                kind,
                name: name || null,
                phone: phones[0] ?? null,
                email: emails[0] ?? null,
                gstin,
                accountGroup: null,
                openingBalance,
                openingType,
                errors,
            });
            continue;
        }

        for (const p of phones) phoneClaims.set(p, row.rowIndex);
        for (const e of emails) emailClaims.set(e, row.rowIndex);

        const willSkip = existing != null && req.mode === "skip";
        const action: RowResult["action"] = willSkip ? "skip" : existing != null ? "update" : "create";

        results.push({
            rowIndex: row.rowIndex,
            action,
            kind,
            name,
            phone: phones[0] ?? null,
            email: emails[0] ?? null,
            gstin,
            accountGroup,
            openingBalance,
            openingType,
            errors: [],
        });

        if (willSkip) continue;

        validRows.push({
            rowIndex: row.rowIndex,
            existingId: existing?.id ?? null,
            kind,
            data: {
                name,
                address: v.address?.trim() || null,
                agreedToTerms: agreed ?? null,
                gstin,
                gstStateCode,
                gstRegType,
                shippingStateCode,
                companyReg: v.companyReg?.trim() || null,
                taxId: v.taxId?.trim() || null,
            },
            phones,
            emails,
            accountGroup,
            openingBalance,
            openingType,
            creditLimit: creditLimit ?? null,
        });
    }

    const willCreate = results.filter((r) => r.action === "create").length;
    const willUpdate = results.filter((r) => r.action === "update").length;
    const willSkip = results.filter((r) => r.action === "skip").length;
    const errorCount = results.filter((r) => r.action === "error").length;

    if (req.dryRun || validRows.length === 0) {
        return { willCreate, willUpdate, willSkip, errorCount, results };
    }

    // ── Commit. Resolve both account groups once, then run one transaction.
    const [debtorsGroup, creditorsGroup] = await Promise.all([
        prisma.accountGroup.findFirst({
            where: { name: ACCOUNT_GROUPS.SUNDRY_DEBTORS },
            select: { id: true },
        }),
        prisma.accountGroup.findFirst({
            where: { name: ACCOUNT_GROUPS.SUNDRY_CREDITORS },
            select: { id: true },
        }),
    ]);
    const groupIdFor = (g: "Sundry Debtors" | "Sundry Creditors") =>
        (g === "Sundry Debtors" ? debtorsGroup?.id : creditorsGroup?.id) ?? null;

    const anyOpening = validRows.some((v) => v.openingBalance != null && v.openingBalance !== 0);

    // ── Split work: bulk-insert new rows; per-row for updates (rare on imports).
    const newRows = validRows.filter((v) => v.existingId == null);
    const updateRows = validRows.filter((v) => v.existingId != null);
    const newPersons = newRows.filter((v) => v.kind === "person");
    const newCompanies = newRows.filter((v) => v.kind === "company");

    // Chunk size for createMany / createManyAndReturn. Same value the product
    // importer uses — fits comfortably under Postgres's parameter limit even
    // with the widest row (~12 columns × 500 = 6,000 params, vs PG's ~65k).
    const CHUNK = 500;

    await prisma.$transaction(
        async (tx) => {
            // ── 1. Bulk-insert new Persons; capture their IDs in input order.
            //    Postgres returns RETURNING rows in the same order as the
            //    multi-row INSERT it was given, so personIds[i] lines up with
            //    newPersons[i].
            const personIds: number[] = [];
            for (let i = 0; i < newPersons.length; i += CHUNK) {
                const slice = newPersons.slice(i, i + CHUNK);
                const inserted = await tx.person.createManyAndReturn({
                    data: slice.map((v) => ({
                        name: v.data.name,
                        address: v.data.address,
                        agreedToTerms: v.data.agreedToTerms ?? false,
                        agreedAt: v.data.agreedToTerms ? new Date() : null,
                        gstin: v.data.gstin,
                        gstStateCode: v.data.gstStateCode,
                        gstRegType: v.data.gstRegType,
                        shippingStateCode: v.data.shippingStateCode,
                    })),
                    select: { id: true },
                });
                personIds.push(...inserted.map((r) => r.id));
            }

            // ── 2. Bulk-insert new Companies; same ordering contract.
            const companyIds: number[] = [];
            for (let i = 0; i < newCompanies.length; i += CHUNK) {
                const slice = newCompanies.slice(i, i + CHUNK);
                const inserted = await tx.company.createManyAndReturn({
                    data: slice.map((v) => ({
                        name: v.data.name,
                        address: v.data.address,
                        companyReg: v.data.companyReg,
                        taxId: v.data.taxId,
                        gstin: v.data.gstin,
                        gstStateCode: v.data.gstStateCode,
                        gstRegType: v.data.gstRegType,
                        shippingStateCode: v.data.shippingStateCode,
                    })),
                    select: { id: true },
                });
                companyIds.push(...inserted.map((r) => r.id));
            }

            // ── 3. Bulk-insert Phones, Emails, Accounts for every new row at once.
            const phoneRows: Array<{ phone: string; personId: number | null; companyId: number | null; isPrimary: boolean }> = [];
            const emailRows: Array<{ email: string; personId: number | null; companyId: number | null; isPrimary: boolean }> = [];
            const accountRows: Array<{
                personId: number | null;
                companyId: number | null;
                name: string;
                groupId: number | null;
                openingBalance?: number;
                openingBalanceType?: "DEBIT" | "CREDIT";
                creditLimit?: number;
            }> = [];

            const pushChildren = (
                v: (typeof newRows)[number],
                personId: number | null,
                companyId: number | null,
            ) => {
                v.phones.forEach((phone, idx) =>
                    phoneRows.push({ phone, personId, companyId, isPrimary: idx === 0 }),
                );
                v.emails.forEach((email, idx) =>
                    emailRows.push({ email, personId, companyId, isPrimary: idx === 0 }),
                );
                accountRows.push({
                    personId,
                    companyId,
                    name: v.data.name,
                    groupId: groupIdFor(v.accountGroup),
                    ...(v.openingBalance != null && v.openingBalance !== 0 && {
                        openingBalance: v.openingBalance,
                        openingBalanceType: v.openingType!,
                    }),
                    ...(v.creditLimit != null && v.creditLimit > 0 && {
                        creditLimit: v.creditLimit,
                    }),
                });
            };
            newPersons.forEach((v, i) => pushChildren(v, personIds[i], null));
            newCompanies.forEach((v, i) => pushChildren(v, null, companyIds[i]));

            for (let i = 0; i < phoneRows.length; i += CHUNK) {
                await tx.phone.createMany({ data: phoneRows.slice(i, i + CHUNK) });
            }
            for (let i = 0; i < emailRows.length; i += CHUNK) {
                await tx.email.createMany({ data: emailRows.slice(i, i + CHUNK) });
            }
            for (let i = 0; i < accountRows.length; i += CHUNK) {
                await tx.account.createMany({ data: accountRows.slice(i, i + CHUNK) });
            }

            // ── 4. Updates path — per-row (rare on bulk imports).
            for (const v of updateRows) {
                {
                    // ── Update existing record ──
                    if (v.kind === "person") {
                        await tx.person.update({
                            where: { id: v.existingId! },
                            data: {
                                name: v.data.name,
                                ...(v.data.address != null && { address: v.data.address }),
                                ...(v.data.agreedToTerms != null && {
                                    agreedToTerms: v.data.agreedToTerms,
                                    agreedAt: v.data.agreedToTerms ? new Date() : null,
                                }),
                                ...(v.data.gstin != null && { gstin: v.data.gstin }),
                                ...(v.data.gstStateCode != null && { gstStateCode: v.data.gstStateCode }),
                                ...(v.data.gstRegType != null && { gstRegType: v.data.gstRegType }),
                                ...(v.data.shippingStateCode != null && {
                                    shippingStateCode: v.data.shippingStateCode,
                                }),
                            },
                        });
                    } else {
                        await tx.company.update({
                            where: { id: v.existingId! },
                            data: {
                                name: v.data.name,
                                ...(v.data.address != null && { address: v.data.address }),
                                ...(v.data.companyReg != null && { companyReg: v.data.companyReg }),
                                ...(v.data.taxId != null && { taxId: v.data.taxId }),
                                ...(v.data.gstin != null && { gstin: v.data.gstin }),
                                ...(v.data.gstStateCode != null && { gstStateCode: v.data.gstStateCode }),
                                ...(v.data.gstRegType != null && { gstRegType: v.data.gstRegType }),
                                ...(v.data.shippingStateCode != null && {
                                    shippingStateCode: v.data.shippingStateCode,
                                }),
                            },
                        });
                    }

                    const ownerKeyForPhone = v.kind === "person"
                        ? { personId: v.existingId }
                        : { companyId: v.existingId };
                    const ownerKeyForEmail = ownerKeyForPhone;

                    if (v.phones.length > 0) {
                        const have = await tx.phone.findMany({
                            where: ownerKeyForPhone,
                            select: { phone: true },
                        });
                        const haveSet = new Set(have.map((r) => r.phone));
                        const fresh = v.phones.filter((p) => !haveSet.has(p));
                        if (fresh.length > 0) {
                            await tx.phone.createMany({
                                data: fresh.map((phone) => ({
                                    phone,
                                    personId: v.kind === "person" ? v.existingId! : null,
                                    companyId: v.kind === "company" ? v.existingId! : null,
                                    isPrimary: false,
                                })),
                            });
                        }
                    }
                    if (v.emails.length > 0) {
                        const have = await tx.email.findMany({
                            where: ownerKeyForEmail,
                            select: { email: true },
                        });
                        const haveSet = new Set(have.map((r) => r.email));
                        const fresh = v.emails.filter((e) => !haveSet.has(e));
                        if (fresh.length > 0) {
                            await tx.email.createMany({
                                data: fresh.map((email) => ({
                                    email,
                                    personId: v.kind === "person" ? v.existingId! : null,
                                    companyId: v.kind === "company" ? v.existingId! : null,
                                    isPrimary: false,
                                })),
                            });
                        }
                    }

                    // Patch the linked Account: switch group if needed, update
                    // opening / credit limit if provided. Find the account by
                    // owner key — every Person and Company has exactly one.
                    const accountWhere = v.kind === "person"
                        ? { personId: v.existingId }
                        : { companyId: v.existingId };
                    const account = await tx.account.findFirst({
                        where: accountWhere,
                        select: { id: true },
                    });
                    if (account) {
                        const accountPatch: {
                            name?: string;
                            groupId?: number | null;
                            openingBalance?: number;
                            openingBalanceType?: "DEBIT" | "CREDIT";
                            creditLimit?: number;
                        } = { name: v.data.name };
                        if (v.openingBalance != null && v.openingBalance !== 0) {
                            accountPatch.groupId = groupIdFor(v.accountGroup);
                            accountPatch.openingBalance = v.openingBalance;
                            accountPatch.openingBalanceType = v.openingType!;
                        }
                        if (v.creditLimit != null && v.creditLimit > 0) {
                            accountPatch.creditLimit = v.creditLimit;
                        }
                        await tx.account.update({ where: { id: account.id }, data: accountPatch });
                    }
                }
            }
        },
        { timeout: 10 * 60 * 1000, maxWait: 30_000 },
    );

    if (anyOpening) {
        await reconcileOpeningSuspense();
    }

    return { willCreate, willUpdate, willSkip, errorCount, results };
}
