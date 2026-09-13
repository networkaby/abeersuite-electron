// Audit trail for un-cancel (restore). Shared by the three restore routes.
//
// The row is written with `restoredAt` / `restoredById` ALREADY SET, which is not
// cosmetic — two readers key off `restoredAt: null`:
//
//   • the Recycle Bin list (GET /api/audit) hides restored rows by default, so a
//     RESTORED row must not offer itself as something still to recover;
//   • the Day Book treats every `restoredAt: null` AuditLog row as a TOMBSTONE
//     for a removed voucher — left null here, un-cancelling a voucher would make
//     it disappear from the day book, the exact opposite of restoring it.
//
// Stamped, the row is pure history: it shows up only under "include restored".

import { prisma } from "@/shared/lib/prisma/prismaClient";
import type { AuditEntityType } from "@/modules/accountancy/lib/voucherLifecycle";

export async function writeRestoreAudit(args: {
    entityType: AuditEntityType;
    subtype?: string | null;
    originalId: number;
    originalRef: string;
    reason: string;
    actorId: number;
}): Promise<void> {
    const now = new Date();
    await prisma.auditLog.create({
        data: {
            entityType:   args.entityType,
            subtype:      args.subtype ?? null,
            originalId:   args.originalId,
            originalRef:  args.originalRef,
            action:       "RESTORED",
            reason:       args.reason,
            snapshot:     {},
            actorId:      args.actorId,
            restoredAt:   now,
            restoredById: args.actorId,
        },
    });
}
