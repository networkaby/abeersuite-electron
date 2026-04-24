import { NextResponse } from "next/server";

// Relationships are now managed via /api/companies/[id]/links
export async function GET() {
    return NextResponse.json({ error: "Use /api/companies/[id]/links for relationship management" }, { status: 410 });
}

export async function POST() {
    return NextResponse.json({ error: "Use /api/companies/[id]/links for relationship management" }, { status: 410 });
}

export async function DELETE() {
    return NextResponse.json({ error: "Use /api/companies/[id]/links for relationship management" }, { status: 410 });
}
