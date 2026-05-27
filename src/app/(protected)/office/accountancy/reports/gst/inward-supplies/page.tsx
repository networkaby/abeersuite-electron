"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { GstSummaryView } from "@/modules/accountancy/components/GstSummaryView";

export default function GstInwardSuppliesPage() {
    return (
        <ScrollArea className="h-full" type="always">
        <div className="px-6 pt-3 pb-6">
            <GstSummaryView
                title="Inward Supplies — GST"
                subtitle="GST paid on purchases — input tax credit (ITC) available, broken down by tax rate."
                direction="INWARD"
            />
        </div>
        </ScrollArea>
    );
}
