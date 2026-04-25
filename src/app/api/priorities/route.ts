import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-guard";
import { PRIORITY_META } from "@/utils/constants";

export async function GET() {
    const { response } = await requireAuth();
    if (response) return response;

    const priorities = Object.entries(PRIORITY_META).map(([id, meta]) => ({
        id,
        label: meta.label,
    }));
    return NextResponse.json(priorities);
}
