import { NextResponse } from "next/server";

// Redirect legacy /api/customers/[id] calls to /api/accounts/[id]
export async function GET(req: Request) {
    const url = new URL(req.url);
    return NextResponse.redirect(url.href.replace("/api/customers", "/api/accounts"));
}

export async function PUT(req: Request) {
    const url = new URL(req.url);
    return NextResponse.redirect(url.href.replace("/api/customers", "/api/accounts"), { status: 307 });
}

export async function DELETE(req: Request) {
    const url = new URL(req.url);
    return NextResponse.redirect(url.href.replace("/api/customers", "/api/accounts"), { status: 307 });
}
