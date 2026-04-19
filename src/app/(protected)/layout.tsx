import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { Toaster } from "sonner";
import SessionWrapper from "@/components/SessionWrapper";
import QuickTicketButton from "@/components/QuickTicketButton";

export default async function ProtectedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();
    if (!session) redirect("/login");

    return (
        <SessionWrapper>
            <div className="flex min-h-screen bg-gray-100">
                <Sidebar user={{
                    name: session.user?.name,
                    role: (session.user as { role?: string } | undefined)?.role,
                    roles: (session.user as { roles?: string[] } | undefined)?.roles,
                }} />
                <main className="flex-1 p-8 overflow-auto">{children}</main>
                <Toaster richColors />
                <QuickTicketButton />
            </div>
        </SessionWrapper>
    );
}