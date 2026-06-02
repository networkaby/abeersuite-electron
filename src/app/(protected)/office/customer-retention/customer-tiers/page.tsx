import { ScrollArea } from "@/components/ui/scroll-area";
import { Crown } from "lucide-react";
import { CustomerTiers } from "@/modules/customer/components/CustomerTiers";

export const metadata = { title: "Spend Tiers" };

export default function CustomerTiersPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-3xl space-y-6 px-6 pt-4 pb-10">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                        <Crown size={22} />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold leading-tight">Spend Tiers</h1>
                        <p className="text-sm text-muted-foreground">
                            Automatic discount tiers based on a customer&rsquo;s lifetime spend. Applied at POS on pre-GST goods;
                            separate from loyalty points.
                        </p>
                    </div>
                </div>
                <CustomerTiers />
            </div>
        </ScrollArea>
    );
}
