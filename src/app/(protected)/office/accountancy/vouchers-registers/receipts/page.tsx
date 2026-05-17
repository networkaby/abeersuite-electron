import { VoucherList } from "@/modules/accountancy/components/VoucherList";

export default function Page() {
    return (
        <VoucherList
            type="RECEIPT"
            title="Receipts"
            subtitle="Money received — from customers, debtors, or other income sources"
            basePath="/office/accountancy/receipts"
            newPath="/vouchers/receipts/new"
        />
    );
}
