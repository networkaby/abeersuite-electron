import { EscapeBack } from "@/shared/components/EscapeBack";

// A colleague's profile is a drill-in, so Esc → back. It has no breadcrumb to
// carry `escapeBack`, hence the standalone hook component. The page binds no
// Escape handler itself.
//
// Note this area needs no permission — reachable by a user with no operational
// position — so it must stay ungated.
export default function UserAreaLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <EscapeBack />
            {children}
        </>
    );
}
