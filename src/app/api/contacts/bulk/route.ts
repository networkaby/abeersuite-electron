import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest, handleApiError } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { z } from "zod";

// Bulk actions over a set of selected contacts (People). Gated by org-scope edit.
const bulkSchema = z.object({
    ids: z.array(z.coerce.number().int().positive()).min(1, "Select at least one contact").max(5000),
    action: z.discriminatedUnion("type", [
        z.object({ type: z.literal("lifecycle"), value: z.enum(["LEAD", "PROSPECT", "CUSTOMER", "INACTIVE"]) }),
        z.object({ type: z.literal("assignOwner"), value: z.string().trim().min(1).nullable() }),
        z.object({ type: z.literal("addTag"), value: z.string().trim().min(1).max(40) }),
        z.object({ type: z.literal("removeTag"), value: z.string().trim().min(1).max(40) }),
        z.object({ type: z.literal("activate") }),
        z.object({ type: z.literal("deactivate") }),
    ]),
});

export async function POST(req: Request) {
    const { response } = await requirePermission(PERMISSIONS.CUSTOMERS_EDIT);
    if (response) return response;
    try {
        const { data, error } = await validateRequest(req, bulkSchema);
        if (error) return error;
        const { ids, action } = data;

        let affected = 0;
        switch (action.type) {
            case "lifecycle": {
                const r = await prisma.person.updateMany({ where: { id: { in: ids } }, data: { lifecycleStage: action.value } });
                affected = r.count;
                break;
            }
            case "assignOwner": {
                if (action.value) {
                    const pos = await prisma.position.findUnique({ where: { id: action.value }, select: { id: true } });
                    if (!pos) return NextResponse.json({ error: "Position not found" }, { status: 400 });
                }
                const r = await prisma.person.updateMany({ where: { id: { in: ids } }, data: { ownerPositionId: action.value } });
                affected = r.count;
                break;
            }
            case "activate":
            case "deactivate": {
                const r = await prisma.person.updateMany({
                    where: { id: { in: ids } },
                    data: { isActive: action.type === "activate" },
                });
                affected = r.count;
                break;
            }
            case "addTag": {
                // Append + de-dup the array per row.
                affected = await prisma.$executeRaw`
                    UPDATE "Person"
                    SET tags = (SELECT array_agg(DISTINCT t) FROM unnest(array_append(tags, ${action.value})) AS t)
                    WHERE id = ANY(${ids})`;
                break;
            }
            case "removeTag": {
                affected = await prisma.$executeRaw`
                    UPDATE "Person" SET tags = array_remove(tags, ${action.value}) WHERE id = ANY(${ids})`;
                break;
            }
        }

        return NextResponse.json({ ok: true, affected });
    } catch (e) {
        return handleApiError(e, "Bulk action failed");
    }
}
