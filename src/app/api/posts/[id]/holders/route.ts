import { prisma } from "@/shared/lib/prisma/prismaClient";
import { NextResponse } from "next/server";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { z } from "zod";
import { validateRequest } from "@/shared/lib/api";

const assignSchema = z.object({ userId: z.number().int().positive() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        const { id: postId } = await params;
        const { data, error } = await validateRequest(req, assignSchema);
        if (error) return error;
        const { userId } = data;
        const existing = await prisma.userPost.findUnique({ where: { userId_postId: { userId, postId } } });
        if (existing) return NextResponse.json({ error: "User already holds this post" }, { status: 409 });
        await prisma.userPost.create({ data: { userId, postId } });
        return NextResponse.json({ success: true }, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Failed to assign holder" }, { status: 500 });
    }
}
