import { ScrollArea } from "@/components/ui/scroll-area";
import { CreditCard } from "lucide-react";
import { GiftCards } from "@/modules/coupons/components/GiftCards";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";

export const metadata = { title: "Gift Cards" };

export default async function GiftCardsPage() {
    const org = await getOrganisation();
    return (
        <ScrollArea className="h-full" type="always">
            <div className="w-full space-y-6 px-6 pt-4 pb-10">
                {/* <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400">
                        <CreditCard size={22} />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold leading-tight">Gift Cards</h1>
                        <p className="text-sm text-muted-foreground">
                            Prepaid store credit. Issuing posts Dr Cash / Cr &ldquo;Gift Card Liability&rdquo;; redeeming at POS draws the liability down as a payment tender.
                        </p>
                    </div>
                </div> */}
                <GiftCards brandName={org.brandName} />
            </div>
        </ScrollArea>
    );
}
