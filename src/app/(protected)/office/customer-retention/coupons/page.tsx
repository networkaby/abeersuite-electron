import { ScrollArea } from "@/components/ui/scroll-area";
import { TicketPercent } from "lucide-react";
import { CouponList } from "@/modules/coupons/components/CouponList";
import { CouponConfigCard } from "@/modules/coupons/components/CouponConfigCard";

export const metadata = { title: "Coupons & Gift Cards" };

export default function CouponsPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-3xl space-y-6 px-6 pt-4 pb-10">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
                        <TicketPercent size={22} />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold leading-tight">Coupons &amp; Gift Cards</h1>
                        <p className="text-sm text-muted-foreground">
                            Run promotions across POS and the online shop. % off, flat ₹, with validity, usage limits, and stacking control.
                        </p>
                    </div>
                </div>
                <CouponConfigCard />
                <CouponList />
            </div>
        </ScrollArea>
    );
}
