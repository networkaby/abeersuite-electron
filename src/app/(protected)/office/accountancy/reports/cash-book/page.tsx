"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { BookPage } from "@/modules/accountancy/components/BookPage";

export default function CashBookPage() {
    return (
        <ScrollArea className="h-full" type="always">
        <div className="px-6 pt-3 pb-6">
            <BookPage
                title="Cash Book"
                subtitle="All transactions affecting cash ledgers — click a ledger to drill into the running register."
                groupName="Cash-in-Hand"
            />
        </div>
        </ScrollArea>
    );
}
