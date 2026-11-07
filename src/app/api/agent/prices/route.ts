import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { requireIncomingKey } from "@/modules/incoming/lib/incomingApi";
import { pricesQuery, productPrices } from "@/modules/ecommerce/lib/agentPrices";

// GET /api/agent/prices?sku=&q=&brand=&group=&stage=&inStock=&withCost=&limit=&before= —
// Price Watch, read only ("Claude — Price watch" key). Our shop price (barcode tag),
// MRP and stock; last purchase cost only with withCost=1. Default: published, in stock.
// Claude compares with Amazon.in / Flipkart / the maker and writes the report itself.

export async function GET(req: Request) {
    if (!(await requireIncomingKey(req, "PRICE_WATCH"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = new URL(req.url);
    const q = pricesQuery.safeParse(Object.fromEntries(url.searchParams));
    if (!q.success) return NextResponse.json({ error: q.error.issues[0]?.message ?? "Bad query" }, { status: 400 });
    try {
        return NextResponse.json(await productPrices(q.data, url.origin));
    } catch (e) {
        return handleApiError(e, "Failed to load prices");
    }
}
