import { notFound } from "next/navigation";
import MobileHeader from "@/modules/mobile/components/MobileHeader";
import { LegalSectionBlock } from "@/modules/external/legal/LegalDocPage";
import { LEGAL_DOCS } from "@/shared/lib/legal/legalContent";
import { APP } from "@/modules/external/shopApp/appPaths";

/** A policy (terms, privacy, refunds, shipping) as an app screen — the website's own text. */
export default async function CustomerAppPolicyPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params;
    const doc = LEGAL_DOCS.find((d) => d.slug === slug);
    if (!doc) notFound();
    return (
        <>
            <MobileHeader title={doc.title} back={`${APP}/account`} />
            <main className="space-y-6 bg-background px-4 py-5">
                <p className="text-sm text-muted-foreground">{doc.summary}</p>
                {doc.sections.map((section, i) => (
                    <LegalSectionBlock key={section.heading} section={section} index={i} />
                ))}
            </main>
        </>
    );
}

export function generateStaticParams() {
    return LEGAL_DOCS.map((d) => ({ slug: d.slug }));
}
