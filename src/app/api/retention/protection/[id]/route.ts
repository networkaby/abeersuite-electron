import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";

export async function DELETE(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    // RBAC bridge: match the page layout — sidebar link grant OR manage capability.
    const { response } = await requireAnyPermission(
        sidebarChildPermissionId("retention", "protection"),
        PERMISSIONS.RETENTION_PROTECTION_MANAGE,
    );
    if (response) return response;

    const { id: rawId } = await params;
    const id = parseInt(rawId);
    if (isNaN(id)) {
        return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    await prisma.productProtection.delete({
        where: { id },
    });

    return new NextResponse(null, { status: 204 });
}
