import PortalHeader from "@/modules/external/portal/PortalHeader";

export default function PortalSectionLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen flex flex-col bg-background text-foreground">
            <PortalHeader />
            <div className="flex-1">{children}</div>
        </div>
    );
}
