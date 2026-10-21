import { Suspense } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AiSetupPanel } from "@/modules/settings/components/AiSetupPanel";

export const metadata = { title: "AI Setup" };

export default function AiSetupPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-8">
                <div>
                    <h1 className="text-xl font-semibold">AI Setup</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Keys are added once, on the Keys tab. Each other tab is one AI job: which keys each of its steps tries, and in what order.
                    </p>
                </div>
                {/* The panel reads ?tab=, which needs a Suspense boundary at build time. */}
                <Suspense>
                    <AiSetupPanel />
                </Suspense>
            </div>
        </ScrollArea>
    );
}
