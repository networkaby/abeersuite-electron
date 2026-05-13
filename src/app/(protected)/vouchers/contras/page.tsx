import { VoucherList } from "@/modules/accountancy/components/VoucherList";

export default function Page() {
    return (
        <VoucherList
            type="CONTRA"
            title="Contras"
            subtitle="Inter-account transfers between cash and bank accounts"
            basePath="/vouchers/contras"
            newPath="/vouchers/contras/new"
        />
    );
}
