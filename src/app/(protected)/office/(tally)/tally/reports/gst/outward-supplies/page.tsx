"use client";

import { GstSummaryView } from "@/modules/tally/components/GstSummaryView";

export default function GstOutwardSuppliesPage() {
    return (
        <GstSummaryView
            title="Outward Supplies — GST"
            subtitle="GST collected on sales, broken down by tax rate. The output-tax side of your GSTR-3B."
            direction="OUTWARD"
        />
    );
}
