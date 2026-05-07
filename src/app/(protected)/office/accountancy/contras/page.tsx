"use client";
import { VoucherList } from "@/modules/accountancy/components/VoucherList";

export default function ContrasPage() {
    return (
        <VoucherList
            type="CONTRA"
            title="Contras"
            subtitle="Cash ↔ bank and inter-account transfers"
            basePath="/office/accountancy/contras"
            newPath="/office/accountancy/contras/new"
        />
    );
}
