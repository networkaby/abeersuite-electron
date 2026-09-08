"use client";

import { OutstandingsReportScreen } from "@/modules/accountancy/components/OutstandingsReportScreen";

export default function ReceivablesPage() {
    return (
        <OutstandingsReportScreen
            title="Receivables"
            subtitle="Open bills from Sundry Debtors with ageing buckets — click a party to drill into bills."
            apiPath="/api/accountancy/reports/receivables"
            loadError="Failed to load receivables"
            emptyText={{ party: "No outstanding receivables.", bill: "No outstanding bills." }}
            settleHint="Settle this bill against a receipt, credit note, purchase or journal of this party"
        />
    );
}
