import { GlVoucherList } from "@/modules/accountancy/components/GlVoucherList";

export default function Page() {
    return (
        <GlVoucherList
            type="RECEIPT"
            title="Receipts"
            subtitle="Money received — from customers, debtors, or other income sources"
            basePath="/office/accountancy/receipts"
            newPath="/vouchers/receipts/new"
        />
    );
}
