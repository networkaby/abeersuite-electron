"use client";
import { InvVoucherDetail } from "@/modules/inventory/components/InvVoucherDetail";

export default function BranchTransferDetailPage() {
    return (
        <InvVoucherDetail
            basePath="/office/accountancy/vouchers-registers/branch-transfers"
            formPath="/vouchers/branch-transfers/new"
            label="Branch Transfer"
        />
    );
}
