import { Undo2 } from "lucide-react";
import { RefundBoard } from "@/modules/refund/components/RefundBoard";

// O2C Refund sub-pipeline (P9) — pay back advances on rejected / cancelled orders.
export default function RefundPage() {
    return (
        <div className="space-y-4 p-4">
            <div>
                <h1 className="flex items-center gap-2 text-xl font-semibold">
                    <Undo2 size={18} className="text-primary" /> Refunds
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                    A refund is created when an order with a collected advance is rejected / cancelled. Drag to move its stage.
                </p>
            </div>
            <RefundBoard />
        </div>
    );
}
