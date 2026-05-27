"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { GstSummaryView } from "@/modules/accountancy/components/GstSummaryView";

export default function GstOutwardSuppliesPage() {
    return (
        <ScrollArea className="h-full" type="always">
        <div className="px-6 pt-3 pb-6">
            <GstSummaryView
                title="Outward Supplies — GST"
                subtitle="GST collected on sales, broken down by tax rate. The output-tax side of your GSTR-3B."
                direction="OUTWARD"
            />
        </div>
        </ScrollArea>
    );
}
