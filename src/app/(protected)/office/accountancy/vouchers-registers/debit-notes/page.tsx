import { GlVoucherList } from "@/modules/accountancy/components/GlVoucherList";

export default function Page() {
    return (
        <GlVoucherList
            type="DEBIT_NOTE"
            title="Debit Notes"
            subtitle="Adjustments raised against suppliers — reduces creditor balance"
            basePath="/office/accountancy/debit-notes"
            newPath="/vouchers/debit-notes/new"
        />
    );
}
