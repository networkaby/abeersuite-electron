import InboxModule from "@/components/InboxModule";

export default function InboxPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Inbox</h1>
                <p className="text-sm text-muted-foreground">
                    System inbox, personal inbox, role groups, and the organisation group in one place.
                </p>
            </div>
            <InboxModule />
        </div>
    );
}
