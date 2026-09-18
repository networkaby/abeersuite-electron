"use client";

import { Suspense } from "react";
import { BankReconciliationPage } from "@/modules/accountancy/components/BankReconciliationPage";

// Bank Reconciliation — statement upload, auto/manual matching, "Book it",
// and the reconciled lock. Everything lives in the module component; this
// route only mounts it (Suspense for the `?account=` search param read).
export default function BankReconciliationRoutePage() {
    return (
        <Suspense fallback={null}>
            <BankReconciliationPage />
        </Suspense>
    );
}
