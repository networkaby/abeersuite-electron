// Shared by the bank-reconciliation route handlers: the ledger id off the URL
// and the one error translation, so six small routes do not each carry a copy.

import { NextResponse } from "next/server";
import { handleApiError } from "@/shared/lib/api";
import { BankReconError } from "./bankReconciliation";

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function accountIdOf(p: { accountId: string }): { id: number; error?: undefined } | { id?: undefined; error: NextResponse } {
    const id = Number(p.accountId);
    if (!Number.isInteger(id) || id <= 0) return { error: NextResponse.json({ error: "Bad ledger id" }, { status: 400 }) };
    return { id };
}

export function reconError(e: unknown, fallback: string): NextResponse {
    if (e instanceof BankReconError) return NextResponse.json({ error: e.message }, { status: e.status });
    return handleApiError(e, fallback);
}
