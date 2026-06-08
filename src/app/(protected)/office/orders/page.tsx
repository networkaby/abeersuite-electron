import { ShoppingCart } from "lucide-react";
import { OrdersBoard } from "@/modules/order/components/OrdersBoard";

// O2C order backbone — the execution HOME for orders from every channel.
// (The POS register "Orders" tab and ecommerce admin are read-only mirrors.)
export default function OrdersPage() {
    return (
        <div className="space-y-4 p-4">
            <div>
                <h1 className="flex items-center gap-2 text-xl font-semibold">
                    <ShoppingCart size={18} className="text-primary" /> Orders
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                    Every order — counter, online and office — on one pipeline. Drag a card to move its stage.
                </p>
            </div>
            <OrdersBoard />
        </div>
    );
}
