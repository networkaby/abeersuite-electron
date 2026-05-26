import { Suspense } from "react";
import { PrintLabelsPage } from "@/modules/inventory/components/PrintLabelsPage";
import "./print-labels.css";

export const metadata = { title: "Print barcode labels" };

export default function PrintLabelsRoute() {
    return (
        <div className="space-y-4">
            <div className="print-hide">
                <h1 className="text-xl font-semibold">Print barcode labels</h1>
                <p className="text-sm text-muted-foreground">
                    Add products, set the layout, then send the sheet to your printer. CODE128 symbology.
                </p>
            </div>
            {/* Suspense boundary required because PrintLabelsPage calls
                useSearchParams to read ?fromVoucher= for the GRN / Purchase
                prefill path. Without this Next.js bails the route out of
                static analysis at build time. */}
            <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
                <PrintLabelsPage />
            </Suspense>
        </div>
    );
}
