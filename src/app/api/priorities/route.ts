import { NextResponse } from "next/server";
import { requireAuth } from "@/shared/lib/auth/permissions";
import { PRIORITY_META } from "@/shared/lib/constants/badges";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const priorities = Object.entries(PRIORITY_META).map(([id, meta]) => ({
        id,
        label: meta.label,
    }));
    return NextResponse.json(priorities);
}
