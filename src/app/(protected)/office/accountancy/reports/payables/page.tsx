"use client";

import { OutstandingsReportScreen } from "@/modules/accountancy/components/OutstandingsReportScreen";

export default function PayablesPage() {
    return (
        <OutstandingsReportScreen
            title="Payables"
            subtitle="Open bills to Sundry Creditors with ageing buckets — click a party to drill into bills."
            apiPath="/api/accountancy/reports/payables"
            loadError="Failed to load payables"
            emptyText={{ party: "No outstanding payables.", bill: "No outstanding bills." }}
            settleKind="PAYMENT"
            settleHint="Pay this bill — opens a payment with this bill ticked"
        />
    );
}
