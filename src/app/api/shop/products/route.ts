import { loadStorefrontProducts } from "@/shared/lib/shop/storefrontProducts";
import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";

export async function GET() {
    try {
        return NextResponse.json(await loadStorefrontProducts());
    } catch (e) {
        return handleApiError(e, "Failed to load products");
    }
}
