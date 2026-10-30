import "server-only";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { ADDRESS_SELECT, formatAddress, type AddressData, type AddressRow } from "./address";

/**
 * Writes to a customer's address book. Rules, in one place:
 *  - the first address a customer gets is primary;
 *  - saving the primary rewrites Person.address, so bills and POS keep reading
 *    plain text exactly as before;
 *  - deleting the primary promotes the oldest remaining one.
 */

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * The address book, oldest text carried in: a customer made at the POS or on a
 * counter has only Person.address, so the first read turns that text into
 * their first (primary) address, word for word in line1.
 */
export async function listAddresses(personId: number): Promise<AddressRow[]> {
    const rows = await readAddresses(personId);
    if (rows.length) return rows;
    const person = await prisma.person.findUnique({ where: { id: personId }, select: { address: true } });
    const text = person?.address?.trim();
    if (!text) return [];
    await prisma.personAddress.create({ data: { personId, line1: text.slice(0, 200), isPrimary: true } });
    return readAddresses(personId);
}

function readAddresses(personId: number) {
    return prisma.personAddress.findMany({
        where: { personId },
        select: ADDRESS_SELECT,
        // Primary first, then the most recently used, then oldest.
        orderBy: [{ isPrimary: "desc" }, { lastUsedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    });
}

async function syncPersonText(tx: Tx, personId: number) {
    const primary = await tx.personAddress.findFirst({ where: { personId, isPrimary: true }, select: ADDRESS_SELECT });
    // No address left: leave the old text alone rather than blank a bill line.
    if (primary) await tx.person.update({ where: { id: personId }, data: { address: formatAddress(primary) } });
}

/**
 * Create (id null) or update one address. Returns the saved row, or null when
 * `id` is not this person's. `used` stamps lastUsedAt (checkout).
 */
export async function saveAddress(
    personId: number,
    id: number | null,
    /** Fields left out stay as they are on an update (checkout sends no label / landmark). */
    data: Partial<AddressData> & { line1: string },
    opts: { makePrimary?: boolean; used?: boolean } = {},
): Promise<AddressRow | null> {
    return prisma.$transaction(async (tx) => {
        const has = await tx.personAddress.count({ where: { personId } });
        const makePrimary = opts.makePrimary || has === 0;
        if (id !== null && !(await tx.personAddress.findFirst({ where: { id, personId }, select: { id: true } }))) return null;
        if (makePrimary) await tx.personAddress.updateMany({ where: { personId, isPrimary: true, NOT: id ? { id } : undefined }, data: { isPrimary: false } });

        const fields = { ...data, ...(makePrimary && { isPrimary: true }), ...(opts.used && { lastUsedAt: new Date() }) };
        const row = id === null
            ? await tx.personAddress.create({ data: { personId, ...fields }, select: ADDRESS_SELECT })
            : await tx.personAddress.update({ where: { id }, data: fields, select: ADDRESS_SELECT });
        if (row.isPrimary) await syncPersonText(tx, personId);
        return row;
    });
}

/** Remove one address; false when it is not this person's. */
export async function deleteAddress(personId: number, id: number): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
        const row = await tx.personAddress.findFirst({ where: { id, personId }, select: { isPrimary: true } });
        if (!row) return false;
        await tx.personAddress.delete({ where: { id } });
        if (row.isPrimary) {
            const next = await tx.personAddress.findFirst({ where: { personId }, orderBy: { id: "asc" }, select: { id: true } });
            if (next) {
                await tx.personAddress.update({ where: { id: next.id }, data: { isPrimary: true } });
                await syncPersonText(tx, personId);
            }
        }
        return true;
    });
}
