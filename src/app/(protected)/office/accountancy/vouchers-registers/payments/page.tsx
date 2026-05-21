import { GlVoucherList } from "@/modules/accountancy/components/GlVoucherList";

export default function Page() {
    return (
        <GlVoucherList
            type="PAYMENT"
            title="Payments"
            subtitle="Money paid out — to suppliers, expenses, or party accounts"
            basePath="/office/accountancy/payments"
            newPath="/vouchers/payments/new"
        />
    );
}
