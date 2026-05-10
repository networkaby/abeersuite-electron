"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function RejectionsOutPage() {
    return (
        <InvVoucherList
            type="REJECTION_OUT"
            title="Rejections Out"
            subtitle="Returns to supplier — removes stock; GL posted via Debit Note"
            basePath="/office/inventory/rejections-out"
            newPath="/office/inventory/rejections-out/new"
        />
    );
}
