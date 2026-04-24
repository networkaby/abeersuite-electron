import { NextResponse } from "next/server";

// Redirect legacy /api/customers calls to /api/accounts
export async function GET(req: Request) {
    const url = new URL(req.url);
    const newUrl = url.href.replace("/api/customers", "/api/accounts");
    return NextResponse.redirect(newUrl);
}

export async function POST(req: Request) {
    const url = new URL(req.url);
    const newUrl = url.href.replace("/api/customers", "/api/accounts");
    return NextResponse.redirect(newUrl, { status: 307 });
}
