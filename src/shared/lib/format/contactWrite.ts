// Shared helpers for inserting/updating Phone and Email rows on Person or Company.
// Enforces the XOR constraint at the app layer (Postgres also has a CHECK)
// and translates Prisma P2002 unique-violation errors into a clean 409 payload.

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

export async function createPhone(owner: ContactOwner, input: ContactValueInput) {
    try {
        return await prisma.phone.create({
            data: {
                phone: input.value,
                personId: owner.personId ?? null,
                companyId: owner.companyId ?? null,
                label: input.label ?? null,
                isPrimary: input.isPrimary ?? false,
            },
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
        return await prisma.email.create({
            data: {
                email: input.value,
                personId: owner.personId ?? null,
                companyId: owner.companyId ?? null,
                label: input.label ?? null,
                isPrimary: input.isPrimary ?? false,
            },
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
        return await prisma.phone.update({
            where: { id },
            data: {
                ...(patch.value !== undefined && { phone: patch.value }),
                ...(patch.label !== undefined && { label: patch.label ?? null }),
                ...(patch.isPrimary !== undefined && { isPrimary: patch.isPrimary }),
            },
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
        return await prisma.email.update({
            where: { id },
            data: {
                ...(patch.value !== undefined && { email: patch.value }),
                ...(patch.label !== undefined && { label: patch.label ?? null }),
                ...(patch.isPrimary !== undefined && { isPrimary: patch.isPrimary }),
            },
        });
    } catch (err) {
        if (isUniqueViolation(err, "email")) {
            throw new ContactConflictError("email", patch.value ?? "");
        }
        throw err;
    }
}
