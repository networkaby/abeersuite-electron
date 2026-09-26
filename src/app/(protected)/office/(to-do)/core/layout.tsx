import { EscapeBack } from "@/shared/components/EscapeBack";

// Esc → back for the serial-number lookup, which has no breadcrumb.
export default function CoreLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <EscapeBack />
            {children}
        </>
    );
}
