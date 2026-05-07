"use client";

import { GstSummaryView } from "@/modules/accountancy/components/GstSummaryView";

export default function GstInwardSuppliesPage() {
    return (
        <GstSummaryView
            title="Inward Supplies — GST"
            subtitle="GST paid on purchases — input tax credit (ITC) available, broken down by tax rate."
            direction="INWARD"
        />
    );
}
