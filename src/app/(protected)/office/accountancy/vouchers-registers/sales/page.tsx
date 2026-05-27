"use client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fmt } from "@/utils/constants";
import {
    InvVoucherList,
    type InvVoucherListRow,
} from "@/modules/inventory/components/InvVoucherList";

const PAY_MODE_COLORS: Record<string, string> = {
    CASH:   "bg-blue-50 text-blue-700",
    CREDIT: "bg-purple-50 text-purple-700",
};

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <InvVoucherList
                    type="SALE"
                    title="Sales"
                    subtitle="Sale vouchers — stock & GL ledger"
                    newPath="/vouchers/sales/new"
                    emptyLabel="sale vouchers"
                    extraColumns={[
                        {
                            header:    "Mode",
                            className: "px-4 py-3 text-center text-xs font-medium",
                            cell:      (r) => {
                                const row = r as InvVoucherListRow;
                                return row.paymentMode
                                    ? <span className={`text-xs px-1.5 py-0.5 font-medium rounded-sm ${PAY_MODE_COLORS[row.paymentMode] ?? ""}`}>{row.paymentMode}</span>
                                    : null;
                            },
                        },
                        {
                            header:    "Items",
                            className: "px-4 py-3 text-center text-xs font-medium",
                            cell:      (r) => <span className="text-muted-foreground">{(r as InvVoucherListRow).lineCount}</span>,
                        },
                        {
                            header:    "Balance",
                            className: "px-4 py-3 text-right text-xs font-medium",
                            cell:      (r) => {
                                const row = r as InvVoucherListRow;
                                const bal = row.totalAmount - row.amountReceived;
                                return bal > 0.005
                                    ? <span className="font-mono text-destructive">₹ {fmt(bal)}</span>
                                    : <span className="text-green-600">Paid</span>;
                            },
                        },
                    ]}
                />
            </div>
        </ScrollArea>
    );
}
