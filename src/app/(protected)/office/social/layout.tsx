import { EscapeBack } from "@/shared/components/EscapeBack";

// A colleague's profile is a drill-in, so Esc → back. It has no breadcrumb to
// carry `escapeBack`, hence the standalone hook component. The page binds no
// Escape handler itself.
//
// Note this area is a FREE ROUTE (shared/lib/auth/freeRoutes.ts) — reachable by
// a user with no operational position — so it must stay ungated.
export default function SocialLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <EscapeBack />
            {children}
        </>
    );
}
