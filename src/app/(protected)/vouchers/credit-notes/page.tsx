import { VoucherList } from "@/modules/accountancy/components/VoucherList";

export default function Page() {
    return (
        <VoucherList
            type="CREDIT_NOTE"
            title="Credit Notes"
            subtitle="Allowances granted to customers — reduces debtor balance"
            basePath="/vouchers/credit-notes"
            newPath="/vouchers/credit-notes/new"
        />
    );
}
