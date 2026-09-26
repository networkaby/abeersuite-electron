import { EscapeBack } from "@/shared/components/EscapeBack";

// /office/me needs no permission: a person with no operational position still
// reaches their own portal, so this stays ungated.
export default function MyPortalLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <EscapeBack />
            {children}
        </>
    );
}
