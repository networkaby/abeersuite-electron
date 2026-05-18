"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function Page() {
    return (
        <InvVoucherList
            type="BRANCH_TRANSFER"
            title="Branch Transfers"
            subtitle="Stock movement between locations — out at source, in at destination. No GL impact."
            basePath="/office/accountancy/vouchers-registers/branch-transfers"
            newPath="/vouchers/branch-transfers/new"
        />
    );
}
