import { ScrollArea } from "@/components/ui/scroll-area";
import ProtectionClient from "./ProtectionClient";

export const metadata = { title: "Protection" };

export default function ProtectionPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <ProtectionClient />
        </ScrollArea>
    );
}
