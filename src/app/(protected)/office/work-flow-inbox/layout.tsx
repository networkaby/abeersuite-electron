import { EscapeBack } from "@/shared/components/EscapeBack";

// Work Flow has no breadcrumb of its own, so Esc → back is wired here instead
// of through PathBreadcrumb's `escapeBack`. The board binds no Escape handler
// itself, so nothing double-fires.
export default function WorkFlowInboxLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <EscapeBack />
            {children}
        </>
    );
}
