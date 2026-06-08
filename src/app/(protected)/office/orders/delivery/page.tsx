import { Truck } from "lucide-react";
import { DeliveryBoard } from "@/modules/delivery/components/DeliveryBoard";

// O2C Delivery sub-pipeline (P8) — dispatch & tracking for confirmed orders.
export default function DeliveryPage() {
    return (
        <div className="space-y-4 p-4">
            <div>
                <h1 className="flex items-center gap-2 text-xl font-semibold">
                    <Truck size={18} className="text-primary" /> Delivery
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                    Dispatch &amp; tracking — a delivery is created when an order is confirmed. Drag to move its stage.
                </p>
            </div>
            <DeliveryBoard />
        </div>
    );
}
