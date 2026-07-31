import type { Metadata } from "next";
import ExternalRootShell from "@/modules/external/ExternalRootShell";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

export const metadata: Metadata = {
    // No brand suffix here: the root layout's title template already appends
    // "· Network Service" to every string title below it. Spelling it out again
    // renders "Customer portal · Network Service · Network Service".
    title: "Customer portal",
    description:
        "Network Service customer portal and online storefront for computer hardware purchases, repair tracking, invoices, warranties, and account sign-in.",
    applicationName: COMPANY_DETAILS.brandName,
};

export default function ExternalLayout({ children }: { children: React.ReactNode }) {
    return <ExternalRootShell>{children}</ExternalRootShell>;
}
