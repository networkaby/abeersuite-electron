import { ScrollArea } from "@/components/ui/scroll-area";
import { ScreenSizeForm } from "@/modules/settings/components/ScreenSizeForm";

export const metadata = { title: "Screen Size" };

export default function ScreenSizePage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-8">
                <div>
                    <h1 className="text-xl font-semibold">Screen Size</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Set how large the app draws itself on this counter PC. The office screens
                        were laid out on a large monitor, so a smaller counter screen fits them
                        better at a reduced size.
                    </p>
                </div>
                <ScreenSizeForm />
            </div>
        </ScrollArea>
    );
}
