import { VoucherList } from "@/modules/accountancy/components/VoucherList";

export default function Page() {
    return (
        <VoucherList
            type="DEBIT_NOTE"
            title="Debit Notes"
            subtitle="Adjustments raised against suppliers — reduces creditor balance"
            basePath="/vouchers/debit-notes"
            newPath="/vouchers/debit-notes/new"
        />
    );
}
