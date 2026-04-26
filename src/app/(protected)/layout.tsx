import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { Toaster } from "sonner";
import SessionWrapper from "@/components/SessionWrapper";
import QuickTicketButton from "@/components/QuickTicketButton";
import ButtonBar from "@/components/ButtonBar";

export default async function ProtectedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();
    if (!session) redirect("/login");

    const user = session.user as {
        name?: string | null;
        role?: string;
        roles?: string[];
        permissions?: string[];
    };

    return (
        <SessionWrapper>
            <div className="flex min-h-screen bg-gray-100">
                <Sidebar user={{
                    name: user.name,
                    role: user.role,
                    roles: user.roles,
                    permissions: user.permissions,
                }} />
                <main className="flex-1 p-8 overflow-auto">{children}</main>
                <ButtonBar user={{
                    name: user.name,
                    role: user.role,
                    roles: user.roles,
                    permissions: user.permissions,
                }} />
                <Toaster richColors />
                <QuickTicketButton />
            </div>
        </SessionWrapper>
    );
}
