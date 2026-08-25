import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Lightweight, zero-dependency health check endpoint used by the Electron
 * shell and monitoring to verify that the Next.js HTTP server is actively
 * listening and ready to process requests.
 */
export async function GET() {
    return NextResponse.json(
        { status: "ok", timestamp: new Date().toISOString() },
        {
            status: 200,
            headers: {
                "Cache-Control": "no-store, no-cache, must-revalidate",
            },
        }
    );
}
