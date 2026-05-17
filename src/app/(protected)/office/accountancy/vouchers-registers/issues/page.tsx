"use client";
import { InvVoucherList } from "@/modules/inventory/components/InvVoucherForm";

export default function Page() {
    return (
        <InvVoucherList
            type="ISSUE"
            title="Issues"
            subtitle="Stock issued for internal consumption or transfer — read-only register"
            basePath=""
        />
    );
}
