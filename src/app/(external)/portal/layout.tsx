import PortalAppShell from "@/modules/external/portal/PortalAppShell";

export default function PortalSectionLayout({ children }: { children: React.ReactNode }) {
    return (
        <PortalAppShell>{children}</PortalAppShell>
    );
}
