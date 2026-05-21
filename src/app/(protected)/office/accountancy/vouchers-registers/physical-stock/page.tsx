"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherList";

export default function Page() {
    return (
        <InvVoucherList
            type="PHYSICAL_STOCK"
            title="Physical Stock"
            subtitle="Counted opening qty per date — multiple vouchers on the same date combine (sum). No GL post."
            basePath="/office/accountancy/vouchers-registers/physical-stock"
            newPath="/vouchers/physical-stock/new"
        />
    );
}
