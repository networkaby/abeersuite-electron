import { GlVoucherList } from "@/modules/accountancy/components/GlVoucherList";

export default function Page() {
    return (
        <GlVoucherList
            type="CONTRA"
            title="Contras"
            subtitle="Inter-account transfers between cash and bank accounts"
            basePath="/office/accountancy/contras"
            newPath="/vouchers/contras/new"
        />
    );
}
