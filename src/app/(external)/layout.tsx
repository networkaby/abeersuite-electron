import type { Metadata } from "next";
import ExternalRootShell from "@/modules/external/ExternalRootShell";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

export const metadata: Metadata = {
    title: `Customer portal · ${COMPANY_DETAILS.brandName}`,
    description:
        "Network Service customer portal and online storefront for computer hardware purchases, repair tracking, invoices, warranties, and account sign-in.",
    applicationName: COMPANY_DETAILS.brandName,
};

export default function ExternalLayout({ children }: { children: React.ReactNode }) {
    return <ExternalRootShell>{children}</ExternalRootShell>;
}
