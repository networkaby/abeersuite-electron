"use client";
import { VoucherList } from "@/modules/tally/components/VoucherList";

export default function PaymentsPage() {
    return (
        <VoucherList
            type="PAYMENT"
            title="Payments"
            subtitle="Money paid out — to suppliers, expenses, or party accounts"
            basePath="/office/tally/payments"
            newPath="/office/tally/payments/new"
        />
    );
}
