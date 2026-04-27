import { Suspense } from "react";
import { auth } from "@/auth";
import InboxModule from "@/modules/message/components/InboxModule";
import { Loader2 } from "lucide-react";

export default async function InboxPage() {
    const session = await auth();
    const userId   = session?.user?.id   ? parseInt(session.user.id, 10) : undefined;
    const userName = session?.user?.name ?? undefined;

    return (
        <Suspense fallback={
            <div className="-m-8 flex h-screen items-center justify-center">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
        }>
            <InboxModule currentUserId={userId} currentUserName={userName} />
        </Suspense>
    );
}
