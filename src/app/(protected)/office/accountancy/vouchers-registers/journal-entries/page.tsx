import { ScrollArea } from "@/components/ui/scroll-area";
import { JournalEntriesRegister } from "./_components/JournalEntriesRegister";

export default function Page() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="px-6 pt-3 pb-6">
                <JournalEntriesRegister />
            </div>
        </ScrollArea>
    );
}
