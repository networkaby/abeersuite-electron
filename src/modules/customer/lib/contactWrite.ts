// Shared helpers for inserting/updating/deleting Phone and Email rows on Person/Company.
// Enforces the XOR constraint at the app layer (Postgres also has a CHECK)
// and translates Prisma P2002 unique-violation errors into a clean 409 payload.
// Also manages the "isPrimary" invariant: exactly one primary per owner when any
// exist (first created auto-promotes; deleting a primary auto-promotes the next).

import { z } from "zod";
import { prisma } from "@/shared/lib/prisma/prismaClient";

export type ContactOwner =
    | { personId: number; companyId?: never }
    | { companyId: number; personId?: never };

export const contactValueSchema = z
    .object({
        value: z.string().trim().min(1, "Value is required"),
        label: z.string().trim().optional().nullable(),
        isPrimary: z.boolean().optional(),
    });

export type ContactValueInput = z.infer<typeof contactValueSchema>;

export class ContactConflictError extends Error {
    status = 409;
    constructor(public field: "phone" | "email", value: string) {
        super(`This ${field} (${value}) is already used by another contact`);
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

/** Owner filter shared by all per-owner queries. */
function ownerWhere(owner: ContactOwner) {
    return owner.personId !== undefined
        ? { personId: owner.personId }
        : { companyId: owner.companyId };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

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
    const remaining = kind === "phone"
        ? await tx.phone.findMany({
            where: ownerWhere(owner),
            orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
            take: 1,
            select: { id: true, isPrimary: true },
        })
        : await tx.email.findMany({
            where: ownerWhere(owner),
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
    try {
        return await prisma.$transaction(async (tx) => {
            // Is this the owner's first phone? Then the row must be primary.
            // The caller can also request isPrimary — either way, we end up
            // with one primary and rest non-primary after this insert.
            const existing = await tx.phone.count({ where: ownerWhere(owner) });
            const isFirst = existing === 0;
            const wantPrimary = Boolean(input.isPrimary) || isFirst;

            if (wantPrimary) {
                // Clear existing primaries before marking the new one primary
                // so we don't end up with two primaries (matches the bug you
                // see in the UI right now where both phones say Primary).
                await tx.phone.updateMany({
                    where: { ...ownerWhere(owner), isPrimary: true },
                    data: { isPrimary: false },
                });
            }

            return await tx.phone.create({
                data: {
                    phone: input.value,
                    personId: owner.personId ?? null,
                    companyId: owner.companyId ?? null,
                    label: input.label ?? null,
                    isPrimary: wantPrimary,
                },
            });
        });
    } catch (err) {
        if (isUniqueViolation(err, "phone")) {
            throw new ContactConflictError("phone", input.value);
        }
        throw err;
    }
}

export async function createEmail(owner: ContactOwner, input: ContactValueInput) {
    try {
        return await prisma.$transaction(async (tx) => {
            const existing = await tx.email.count({ where: ownerWhere(owner) });
            const isFirst = existing === 0;
            const wantPrimary = Boolean(input.isPrimary) || isFirst;

            if (wantPrimary) {
                await tx.email.updateMany({
                    where: { ...ownerWhere(owner), isPrimary: true },
                    data: { isPrimary: false },
                });
            }

            return await tx.email.create({
                data: {
                    email: input.value,
                    personId: owner.personId ?? null,
                    companyId: owner.companyId ?? null,
                    label: input.label ?? null,
                    isPrimary: wantPrimary,
                },
            });
        });
    } catch (err) {
        if (isUniqueViolation(err, "email")) {
            throw new ContactConflictError("email", input.value);
        }
        throw err;
    }
}

export async function updatePhone(id: number, patch: Partial<ContactValueInput>) {
    try {
        if (patch.isPrimary !== true) {
            // Simple non-promotion patch.
            return await prisma.phone.update({
                where: { id },
                data: {
                    ...(patch.value !== undefined && { phone: patch.value }),
                    ...(patch.label !== undefined && { label: patch.label ?? null }),
                    ...(patch.isPrimary !== undefined && { isPrimary: patch.isPrimary }),
                },
            });
        }
        // Promotion: clear existing primary on the owner then mark this one.
        const target = await prisma.phone.findUnique({
            where: { id }, select: { id: true, personId: true, companyId: true },
        });
        if (!target) throw new Error("Phone not found");
        const owner: ContactOwner = target.personId != null
            ? { personId: target.personId }
            : { companyId: target.companyId! };

        return await prisma.$transaction(async (tx) => {
            await makePrimaryTx(tx, "phone", owner, id);
            return await tx.phone.update({
                where: { id },
                data: {
                    ...(patch.value !== undefined && { phone: patch.value }),
                    ...(patch.label !== undefined && { label: patch.label ?? null }),
                },
            });
        });
    } catch (err) {
        if (isUniqueViolation(err, "phone")) {
            throw new ContactConflictError("phone", patch.value ?? "");
        }
        throw err;
    }
}

export async function updateEmail(id: number, patch: Partial<ContactValueInput>) {
    try {
        if (patch.isPrimary !== true) {
            return await prisma.email.update({
                where: { id },
                data: {
                    ...(patch.value !== undefined && { email: patch.value }),
                    ...(patch.label !== undefined && { label: patch.label ?? null }),
                    ...(patch.isPrimary !== undefined && { isPrimary: patch.isPrimary }),
                },
            });
        }
        const target = await prisma.email.findUnique({
            where: { id }, select: { id: true, personId: true, companyId: true },
        });
        if (!target) throw new Error("Email not found");
        const owner: ContactOwner = target.personId != null
            ? { personId: target.personId }
            : { companyId: target.companyId! };

        return await prisma.$transaction(async (tx) => {
            await makePrimaryTx(tx, "email", owner, id);
            return await tx.email.update({
                where: { id },
                data: {
                    ...(patch.value !== undefined && { email: patch.value }),
                    ...(patch.label !== undefined && { label: patch.label ?? null }),
                },
            });
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
