"use client";

import { OutstandingsReportScreen } from "@/modules/accountancy/components/OutstandingsReportScreen";

export default function ReceivablesPage() {
    return (
        <OutstandingsReportScreen
            title="Receivables"
            subtitle="Open bills from Sundry Debtors with ageing buckets — click a row to drill into bills, or the party name to open it in Customers."
            apiPath="/api/accountancy/reports/receivables"
            loadError="Failed to load receivables"
            emptyText={{ party: "No outstanding receivables.", bill: "No outstanding bills." }}
            settleKind="RECEIPT"
            settleHint="Receive against this bill — opens a receipt with this bill ticked"
            reminders
        />
    );
}
