"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function RejectionsInPage() {
    return (
        <InvVoucherList
            type="REJECTION_IN"
            title="Rejections In"
            subtitle="Customer returns — adds stock back; GL posted via Credit Note"
            basePath="/office/inventory/rejections-in"
            newPath="/office/inventory/rejections-in/new"
        />
    );
}
