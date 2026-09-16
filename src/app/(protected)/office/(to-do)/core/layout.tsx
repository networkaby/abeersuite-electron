import { EscapeBack } from "@/shared/components/EscapeBack";

// Esc → back for the serial-number lookup, which has no breadcrumb.
//
// Deliberately at `core/` rather than one level up at `(to-do)/`: that would
// also catch `/office/welcome`, where "back" has nowhere sensible to go and
// could bounce a user who has no position yet.
export default function CoreLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <EscapeBack />
            {children}
        </>
    );
}
