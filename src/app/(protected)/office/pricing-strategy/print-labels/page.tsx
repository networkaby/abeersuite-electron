import { Suspense } from "react";
import { PrintLabelsPage } from "@/modules/inventory/components/PrintLabelsPage";
import "./print-labels.css";

export const metadata = { title: "Print barcode labels" };

export default function PrintLabelsRoute() {
    // Suspense boundary required because PrintLabelsPage calls
    // useSearchParams to read ?fromVoucher= for the GRN / Purchase prefill
    // path. Without this Next.js bails the route out of static analysis at
    // build time. The page title lives in the breadcrumb / nav, so no inline
    // heading here — PrintLabelsPage owns its own scroll + padding.
    return (
        <Suspense fallback={<div className="px-6 py-4 text-sm text-muted-foreground">Loading…</div>}>
            <PrintLabelsPage />
        </Suspense>
    );
}
