import type { Metadata } from "next";
import LegalDocPage from "@/modules/external/legal/LegalDocPage";
import { SHIPPING_POLICY } from "@/shared/lib/legal/legalContent";

export const metadata: Metadata = {
    title: SHIPPING_POLICY.title,
    description: SHIPPING_POLICY.summary,
    alternates: { canonical: "/shipping" },
};

export default function ShippingPolicyPage() {
    return <LegalDocPage doc={SHIPPING_POLICY} />;
}
