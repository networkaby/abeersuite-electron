"use client";
import { VoucherList } from "@/modules/accountancy/components/VoucherList";

export default function PaymentsPage() {
    return (
        <VoucherList
            type="PAYMENT"
            title="Payments"
            subtitle="Money paid out — to suppliers, expenses, or party accounts"
            basePath="/office/accountancy/payments"
            newPath="/office/accountancy/payments/new"
        />
    );
}
