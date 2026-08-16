import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { validateRequest } from "@/shared/lib/api/validateRequest";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export async function DELETE(
    req: Request,
    { params }: { params: { id: string } }
) {
    await validateRequest(req, { permission: PERMISSIONS.RETENTION_PROTECTION_MANAGE });

    const id = parseInt(params.id);
    if (isNaN(id)) {
        return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    }

    await prisma.productProtection.delete({
        where: { id },
    });

    return new NextResponse(null, { status: 204 });
}
