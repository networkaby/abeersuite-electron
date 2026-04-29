import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth-guard";
import { z } from "zod";

const assignSchema = z.object({ userId: z.number().int().positive() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { response } = await requirePermission("settings:manage");
    if (response) return response;
    try {
        const { id: postId } = await params;
        const parsed = assignSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid payload" }, { status: 400 });
        }
        const { userId } = parsed.data;
        const existing = await prisma.userPost.findUnique({ where: { userId_postId: { userId, postId } } });
        if (existing) return NextResponse.json({ error: "User already holds this post" }, { status: 409 });
        await prisma.userPost.create({ data: { userId, postId } });
        return NextResponse.json({ success: true }, { status: 201 });
    } catch {
        return NextResponse.json({ error: "Failed to assign holder" }, { status: 500 });
    }
}
