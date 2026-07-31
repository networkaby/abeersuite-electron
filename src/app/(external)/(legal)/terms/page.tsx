import type { Metadata } from "next";
import LegalDocPage from "@/modules/external/legal/LegalDocPage";
import { TERMS_OF_SERVICE } from "@/shared/lib/legal/legalContent";

export const metadata: Metadata = {
    title: TERMS_OF_SERVICE.title,
    description: TERMS_OF_SERVICE.summary,
    alternates: { canonical: "/terms" },
};

export default function TermsOfServicePage() {
    return <LegalDocPage doc={TERMS_OF_SERVICE} />;
}
