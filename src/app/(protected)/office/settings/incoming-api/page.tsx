import { ScrollArea } from "@/components/ui/scroll-area";
import { IncomingApiPanel } from "@/modules/incoming/components/IncomingApiPanel";

export const metadata = { title: "Incoming API" };

export default function IncomingApiPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-4 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-xl font-semibold">Incoming API</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Outside programs that call <b>into</b> this app, and the secret each must send. (Keys the app uses to call
                        out — Gemini, Claude — are on AI Setup.) A new key is shown <b>once</b>: copy it into the other program
                        straight away. A caller set up before this page with a Vercel env var keeps working until you change it here.
                    </p>
                </div>
                <IncomingApiPanel />
            </div>
        </ScrollArea>
    );
}
