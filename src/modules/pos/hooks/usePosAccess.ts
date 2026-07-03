"use client";

import { useMemo } from "react";
import { useSession } from "next-auth/react";
import { canDoPosVoucher } from "@/shared/lib/auth/posVoucherMatrix";

// POS UI access flags derived from the signed-in staff's permissions. Consumed by
// the POS billing screens (Sale / Order / Estimate) to show/hide the top-bar
// actions and mode tabs. `canDoPosVoucher` bakes in the office ⊇ POS rule.
//
// NOTE: this is client-side UI gating only — it hides controls. Real enforcement
// lives in the POS APIs (a follow-up); a hidden button is not a security boundary.
export interface PosAccess {
    canSale: boolean;
    canOrder: boolean;
    canEstimate: boolean;
    canReturn: boolean;
    canRcv: boolean;
    canExp: boolean;
    canDrop: boolean;
}

export function usePosAccess(): PosAccess {
    const { data: session } = useSession();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const key = permissions.join(",");
    return useMemo(() => {
        const perms = key ? key.split(",") : [];
        const isAdmin = perms.includes("admin:bypass");
        const create = (kind: string) => canDoPosVoucher(kind, "create", perms, isAdmin);
        return {
            canSale: create("sale"),
            canOrder: create("order"),
            canEstimate: create("estimate"),
            canReturn: create("sale-return"),
            canRcv: create("receipt"),
            canExp: create("expense"),
            canDrop: isAdmin || perms.includes("pos:shift:drop"),
        };
    }, [key]);
}
