import { GlVoucherList } from "@/modules/accountancy/components/GlVoucherList";

export default function Page() {
    return (
        <GlVoucherList
            type="CREDIT_NOTE"
            title="Credit Notes"
            subtitle="Allowances granted to customers — reduces debtor balance"
            basePath="/office/accountancy/credit-notes"
            newPath="/vouchers/credit-notes/new"
        />
    );
}
