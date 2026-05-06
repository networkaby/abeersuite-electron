"use client";
import { VoucherList } from "@/modules/tally/components/VoucherList";

export default function ContrasPage() {
    return (
        <VoucherList
            type="CONTRA"
            title="Contras"
            subtitle="Cash ↔ bank and inter-account transfers"
            basePath="/office/finance/contras"
            newPath="/office/finance/contras/new"
        />
    );
}
