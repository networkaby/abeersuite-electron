import { ScrollArea } from "@/components/ui/scroll-area";
import { CreditLimitConfigForm } from "@/modules/settings/components/CreditLimitConfigForm";

export const metadata = { title: "Credit Limit" };

export default function CreditLimitSettingsPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-xl font-semibold">Credit Limit Calculation</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Auto-size each customer&apos;s credit limit from their recent sales. Manual limits set on a
                        customer still apply — the register enforces whichever is higher.
                    </p>
                </div>
                <CreditLimitConfigForm />
            </div>
        </ScrollArea>
    );
}
