"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { BookPage } from "@/modules/accountancy/components/BookPage";

export default function BankBookPage() {
    // Don't auto-redirect even if there's only one bank ledger — bank books
    // typically grow over time so the list view is the more useful default.
    return (
        <ScrollArea className="h-full" type="always">
        <div className="px-6 pt-3 pb-6">
            <BookPage
                title="Bank Book"
                subtitle="All bank ledgers with period totals — click any ledger to see its register."
                groupName="Bank Accounts"
                autoSingle={false}
            />
        </div>
        </ScrollArea>
    );
}
