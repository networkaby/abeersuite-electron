// Guards for editing a unit's chain link ("1 KM = 1000 M").
//
// Two separate risks:
//
// 1. STRUCTURE — a chain must terminate. A cycle (A→B→A) would make a
//    quantity impossible to resolve and would hang any walk that trusted the
//    data. Depth is capped for the same reason.
//
// 2. MEANING — quantities are stored in the chain's ROOT unit, so a factor is
//    a LENS over existing numbers, not a conversion of them. If a product
//    holds `stock = 5` meaning 5 KG, and KG is then linked as 1000 G, that 5
//    is re-read as 5 grams. Nothing is corrupted but every figure silently
//    changes meaning, which is worse than an error. So the link may only be
//    set or changed while no product on the unit carries stock.

import { prisma } from "@/shared/lib/prisma/prismaClient";
import { MAX_UNIT_CHAIN_DEPTH } from "./unitFormat";

export type CompoundGuardResult = { ok: true } | { ok: false; message: string };

/**
 * @param unitId     unit being edited
 * @param nextBase   requested baseUnitId (null = make it a root/base unit)
 * @param nextFactor requested conversionFactor, relative to that base
 */
export async function checkCompoundChange(
    unitId:     number,
    nextBase:   number | null | undefined,
    nextFactor: number | null | undefined,
): Promise<CompoundGuardResult> {
    const current = await prisma.invUnit.findUnique({
        where:  { id: unitId },
        select: { baseUnitId: true, conversionFactor: true },
    });
    if (!current) return { ok: true };   // the update itself will 404

    const baseChanged   = nextBase   !== undefined && nextBase   !== current.baseUnitId;
    const factorChanged = nextFactor !== undefined && nextFactor !== current.conversionFactor;
    if (!baseChanged && !factorChanged) return { ok: true };

    if (nextBase != null) {
        if (nextBase === unitId) {
            return { ok: false, message: "A unit cannot be based on itself." };
        }

        // Walk up from the proposed base. Reaching `unitId` would close a loop;
        // running past the depth cap means the chain is already too long.
        const all = await prisma.invUnit.findMany({
            select: { id: true, code: true, baseUnitId: true },
        });
        const byId = new Map(all.map((u) => [u.id, u]));

        let cursor = byId.get(nextBase);
        const walked: string[] = [];
        const seen = new Set<number>();
        while (cursor) {
            if (cursor.id === unitId) {
                const self = byId.get(unitId);
                return {
                    ok: false,
                    message: `That would make a loop: ${self?.code ?? unitId} → ${walked.join(" → ")} → ${self?.code ?? unitId}.`,
                };
            }
            if (seen.has(cursor.id)) break;      // pre-existing loop elsewhere
            seen.add(cursor.id);
            walked.push(cursor.code);
            if (cursor.baseUnitId == null) break;
            cursor = byId.get(cursor.baseUnitId);
        }
        // +1 for the unit being linked on top of the chain we just walked.
        if (walked.length + 1 > MAX_UNIT_CHAIN_DEPTH) {
            return {
                ok: false,
                message: `Unit chain would be ${walked.length + 1} deep (max ${MAX_UNIT_CHAIN_DEPTH}): ${walked.join(" → ")}.`,
            };
        }
    }

    // Any product on this unit holding stock would have its quantity re-read.
    const affected = await prisma.invProduct.count({
        where: { unitId, NOT: { stock: null }, stock: { not: 0 } },
    });
    if (affected > 0) {
        return {
            ok: false,
            message: `${affected} product(s) on this unit still hold stock. Changing the conversion would re-read those quantities (5 would become 5 of the smaller unit, not 5 of this one). Bring their stock to zero first, then set the conversion.`,
        };
    }
    return { ok: true };
}
