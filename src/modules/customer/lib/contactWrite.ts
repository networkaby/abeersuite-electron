// Shared helpers for inserting/updating/deleting Phone and Email rows on Person/Company.
// Enforces the XOR constraint at the app layer (Postgres also has a CHECK)
// and translates Prisma P2002 unique-violation errors into a clean 409 payload.
// Also manages the "isPrimary" invariant: exactly one primary per owner when any
// exist (first created auto-promotes; deleting a primary auto-promotes the next).

import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireCanonicalPhone } from "@/shared/lib/format/phone";

export type ContactOwner =
    | { personId: number; companyId?: never }
    | { companyId: number; personId?: never };

export const contactValueSchema = z
    .object({
        value: z.string().trim().min(1, "Value is required"),
        label: z.string().trim().optional().nullable(),
        isPrimary: z.boolean().optional(),
    });

export type ContactValueInput = z.infer<typeof contactValueSchema> & {
    /**
     * Ownership proof. Staff-entered contacts are verified on entry (default);
     * the portal passes `false` for a contact the customer typed in without an
     * OTP, and such a row can never be primary — see `makePrimaryTx`.
     */
    verified?: boolean;
};

export class ContactConflictError extends Error {
    status = 409;
    constructor(public field: "phone" | "email", value: string) {
        super(`This ${field} (${value}) is already used by another contact`);
    }
}

/** Thrown when an unverified contact is asked to become primary. */
export class ContactUnverifiedError extends Error {
    status = 409;
    constructor(kind: "phone" | "email") {
        super(`Verify this ${kind === "phone" ? "mobile" : "email"} before making it primary`);
    }
}

function isUniqueViolation(err: unknown, target: string): boolean {
    // Duck-type — Prisma error class identity isn't stable across the bundling
    // boundary in dev mode, so `instanceof PrismaClientKnownRequestError` can fail.
    const e = err as { code?: string; meta?: { modelName?: string; target?: string[] | string } } | null;
    if (e?.code !== "P2002") return false;
    const model = e.meta?.modelName?.toLowerCase();
    if (model === target.toLowerCase()) return true;
    const tgt = Array.isArray(e.meta?.target) ? e.meta.target.join(",") : e.meta?.target;
    return typeof tgt === "string" && tgt.includes(target);
}

/** Which party a contact row belongs to — the XOR, read back off a row. */
function ownerOf(row: { personId: number | null; companyId: number | null }): ContactOwner {
    return row.personId != null ? { personId: row.personId } : { companyId: row.companyId! };
}

/** Owner filter shared by all per-owner queries. */
function ownerWhere(owner: ContactOwner) {
    return owner.personId !== undefined
        ? { personId: owner.personId }
        : { companyId: owner.companyId };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Move the owning party's `updatedAt`, in the same transaction as the change.
 *
 * A phone is not a detail hanging off a customer — it is how the customer is
 * FOUND. Every party picker in the app searches the whole party list held in the
 * browser, and that list refreshes by asking "what changed since?", which is a
 * question about `Person.updatedAt` / `Company.updatedAt`. So a phone written
 * without touching its owner is a correction that reaches nobody: the till goes
 * on finding the old number and can never find the new one.
 *
 * `data: {}` is deliberate — Prisma stamps `@updatedAt` on any update, and there
 * is nothing else here worth changing on the parent.
 */
async function touchOwner(tx: Tx, owner: ContactOwner): Promise<void> {
    if (owner.personId !== undefined) {
        await tx.person.update({ where: { id: owner.personId }, data: {} });
    } else {
        await tx.company.update({ where: { id: owner.companyId }, data: {} });
    }
}

/** Within a Prisma transaction, clear any existing primaries for this owner
 *  then mark the chosen id primary. Pass `newPrimaryId = null` to just clear. */
async function makePrimaryTx(
    tx: Tx,
    kind: "phone" | "email",
    owner: ContactOwner,
    newPrimaryId: number | null,
) {
    // Branch on `kind` explicitly — a variable holding `tx.phone | tx.email`
    // isn't callable in TS (union of overloaded delegate types collapses).
    if (newPrimaryId != null) {
        const row = kind === "phone"
            ? await tx.phone.findUnique({ where: { id: newPrimaryId }, select: { verifiedAt: true } })
            : await tx.email.findUnique({ where: { id: newPrimaryId }, select: { verifiedAt: true } });
        if (!row?.verifiedAt) throw new ContactUnverifiedError(kind);
    }
    if (kind === "phone") {
        await tx.phone.updateMany({ where: { ...ownerWhere(owner), isPrimary: true }, data: { isPrimary: false } });
        if (newPrimaryId != null) {
            await tx.phone.update({ where: { id: newPrimaryId }, data: { isPrimary: true } });
        }
    } else {
        await tx.email.updateMany({ where: { ...ownerWhere(owner), isPrimary: true }, data: { isPrimary: false } });
        if (newPrimaryId != null) {
            await tx.email.update({ where: { id: newPrimaryId }, data: { isPrimary: true } });
        }
    }
}

/** When we delete the only-primary, auto-promote the next row (lowest id).
 *  Returns true when the primary was auto-promoted, false if there are none left. */
async function maybePromoteNextAfterDelete(
    tx: Tx,
    kind: "phone" | "email",
    owner: ContactOwner,
): Promise<boolean> {
    // Only a verified row may become primary (unverified ones are portal
    // self-adds nobody has proved yet).
    const remaining = kind === "phone"
        ? await tx.phone.findMany({
            where: { ...ownerWhere(owner), verifiedAt: { not: null } },
            orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
            take: 1,
            select: { id: true, isPrimary: true },
        })
        : await tx.email.findMany({
            where: { ...ownerWhere(owner), verifiedAt: { not: null } },
            orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
            take: 1,
            select: { id: true, isPrimary: true },
        });
    if (remaining.length === 0) return false;
    const first = remaining[0];
    if (first.isPrimary) return false;
    if (kind === "phone") {
        await tx.phone.update({ where: { id: first.id }, data: { isPrimary: true } });
    } else {
        await tx.email.update({ where: { id: first.id }, data: { isPrimary: true } });
    }
    return true;
}

export async function createPhone(owner: ContactOwner, input: ContactValueInput) {
    // One stored form per number, so `+91…` and the bare 10 digits collide on
    // the unique index instead of sitting side by side (canonicalPhone).
    const value = requireCanonicalPhone(input.value);
    try {
        return await prisma.$transaction(async (tx) => {
            // Is this the owner's first phone? Then the row must be primary.
            // The caller can also request isPrimary — either way, we end up
            // with one primary and rest non-primary after this insert.
            const existing = await tx.phone.count({ where: ownerWhere(owner) });
            const isFirst = existing === 0;
            // An unverified row is never primary — not even as the only one.
            const wantPrimary = input.verified !== false && (Boolean(input.isPrimary) || isFirst);

            if (wantPrimary) {
                // Clear existing primaries before marking the new one primary
                // so we don't end up with two primaries (matches the bug you
                // see in the UI right now where both phones say Primary).
                await tx.phone.updateMany({
                    where: { ...ownerWhere(owner), isPrimary: true },
                    data: { isPrimary: false },
                });
            }

            const created = await tx.phone.create({
                data: {
                    phone: value,
                    personId: owner.personId ?? null,
                    companyId: owner.companyId ?? null,
                    label: input.label ?? null,
                    isPrimary: wantPrimary,
                    verifiedAt: input.verified === false ? null : new Date(),
                },
            });
            await touchOwner(tx, owner);
            return created;
        });
    } catch (err) {
        if (isUniqueViolation(err, "phone")) {
            throw new ContactConflictError("phone", value);
        }
        throw err;
    }
}

export async function createEmail(owner: ContactOwner, input: ContactValueInput) {
    try {
        return await prisma.$transaction(async (tx) => {
            const existing = await tx.email.count({ where: ownerWhere(owner) });
            const isFirst = existing === 0;
            const wantPrimary = input.verified !== false && (Boolean(input.isPrimary) || isFirst);

            if (wantPrimary) {
                await tx.email.updateMany({
                    where: { ...ownerWhere(owner), isPrimary: true },
                    data: { isPrimary: false },
                });
            }

            const created = await tx.email.create({
                data: {
                    email: input.value,
                    personId: owner.personId ?? null,
                    companyId: owner.companyId ?? null,
                    label: input.label ?? null,
                    isPrimary: wantPrimary,
                    verifiedAt: input.verified === false ? null : new Date(),
                },
            });
            await touchOwner(tx, owner);
            return created;
        });
    } catch (err) {
        if (isUniqueViolation(err, "email")) {
            throw new ContactConflictError("email", input.value);
        }
        throw err;
    }
}

export async function updatePhone(id: number, patch: Partial<ContactValueInput>) {
    const value = patch.value !== undefined ? requireCanonicalPhone(patch.value) : undefined;
    try {
        // The owner is read up front for BOTH branches, not only the promotion:
        // every edit here has to touch the parent, or the correction never
        // reaches the party lists that search by this number. See `touchOwner`.
        const target = await prisma.phone.findUnique({
            where: { id }, select: { id: true, personId: true, companyId: true },
        });
        if (!target) throw new Error("Phone not found");
        const owner = ownerOf(target);

        return await prisma.$transaction(async (tx) => {
            // Promotion clears any existing primary on the owner first.
            if (patch.isPrimary === true) await makePrimaryTx(tx, "phone", owner, id);
            const updated = await tx.phone.update({
                where: { id },
                data: {
                    ...(value !== undefined && { phone: value }),
                    ...(patch.label !== undefined && { label: patch.label ?? null }),
                    ...(patch.isPrimary !== undefined && patch.isPrimary !== true
                        && { isPrimary: patch.isPrimary }),
                },
            });
            await touchOwner(tx, owner);
            return updated;
        });
    } catch (err) {
        if (isUniqueViolation(err, "phone")) {
            throw new ContactConflictError("phone", value ?? "");
        }
        throw err;
    }
}

export async function updateEmail(id: number, patch: Partial<ContactValueInput>) {
    try {
        const target = await prisma.email.findUnique({
            where: { id }, select: { id: true, personId: true, companyId: true },
        });
        if (!target) throw new Error("Email not found");
        const owner = ownerOf(target);

        return await prisma.$transaction(async (tx) => {
            if (patch.isPrimary === true) await makePrimaryTx(tx, "email", owner, id);
            const updated = await tx.email.update({
                where: { id },
                data: {
                    ...(patch.value !== undefined && { email: patch.value }),
                    ...(patch.label !== undefined && { label: patch.label ?? null }),
                    ...(patch.isPrimary !== undefined && patch.isPrimary !== true
                        && { isPrimary: patch.isPrimary }),
                },
            });
            await touchOwner(tx, owner);
            return updated;
        });
    } catch (err) {
        if (isUniqueViolation(err, "email")) {
            throw new ContactConflictError("email", patch.value ?? "");
        }
        throw err;
    }
}

/** Delete a phone. If the phone being deleted is the current primary, the
 *  next-lowest-id remaining phone is auto-promoted to primary. */
export async function deletePhone(id: number) {
    const row = await prisma.phone.findUnique({
        where: { id },
        select: { id: true, personId: true, companyId: true, isPrimary: true },
    });
    if (!row) throw new Error("Phone not found");
    const owner: ContactOwner = row.personId != null
        ? { personId: row.personId }
        : { companyId: row.companyId! };
    const wasPrimary = row.isPrimary;

    await prisma.$transaction(async (tx) => {
        await tx.phone.delete({ where: { id } });
        if (wasPrimary) {
            await maybePromoteNextAfterDelete(tx, "phone", owner);
        }
        await touchOwner(tx, owner);
    });
}

/** Delete an email. Same primary-auto-promote semantics as deletePhone. */
export async function deleteEmail(id: number) {
    const row = await prisma.email.findUnique({
        where: { id },
        select: { id: true, personId: true, companyId: true, isPrimary: true },
    });
    if (!row) throw new Error("Email not found");
    const owner: ContactOwner = row.personId != null
        ? { personId: row.personId }
        : { companyId: row.companyId! };
    const wasPrimary = row.isPrimary;

    await prisma.$transaction(async (tx) => {
        await tx.email.delete({ where: { id } });
        if (wasPrimary) {
            await maybePromoteNextAfterDelete(tx, "email", owner);
        }
        await touchOwner(tx, owner);
    });
}

/** One-shot PATCH helper: make a specific phone the primary for its owner. */
export async function setPrimaryPhone(id: number) {
    return await updatePhone(id, { isPrimary: true });
}

/** One-shot PATCH helper: make a specific email the primary for its owner. */
export async function setPrimaryEmail(id: number) {
    return await updateEmail(id, { isPrimary: true });
}

/** Stamp ownership proof on a contact (portal OTP, or staff confirming in person).
 *  Verification decides whether a row may be primary, so it changes which number
 *  a party row DISPLAYS — the owner moves with it. */
export async function markPhoneVerified(id: number) {
    return await prisma.$transaction(async (tx) => {
        const updated = await tx.phone.update({ where: { id }, data: { verifiedAt: new Date() } });
        await touchOwner(tx, ownerOf(updated));
        return updated;
    });
}

export async function markEmailVerified(id: number) {
    return await prisma.$transaction(async (tx) => {
        const updated = await tx.email.update({ where: { id }, data: { verifiedAt: new Date() } });
        await touchOwner(tx, ownerOf(updated));
        return updated;
    });
}
