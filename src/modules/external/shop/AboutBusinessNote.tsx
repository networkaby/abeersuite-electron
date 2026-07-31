import Link from "next/link";
import { ABOUT_APP } from "@/shared/lib/shop/storeContent";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

/**
 * The quiet "who runs this site" strip at the bottom of the shop footer —
 * the same job Flipkart's registered-office / CIN block does.
 *
 * Deliberately small and low-contrast: a customer on a storefront does not need
 * the shop explained to them. It earns its place because Google's brand
 * verification requires the home page to describe what the app does and link
 * the privacy policy, and because the GSTIN belongs somewhere findable.
 *
 * Plain crawlable text, no client JS — a reviewer (and a crawler) reads it
 * without running anything.
 */
export default function AboutBusinessNote() {
    return (
        <section
            aria-label="About this business"
            className="border-t border-border/60 bg-muted/20"
        >
            <div className="mx-auto max-w-6xl space-y-2 px-4 py-8 text-xs leading-relaxed text-muted-foreground">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">
                    {ABOUT_APP.title}
                </h2>

                {ABOUT_APP.paragraphs.map((p) => (
                    <p key={p.slice(0, 40)}>{p}</p>
                ))}

                <p>
                    <span className="font-medium text-foreground">What you can do here: </span>
                    {ABOUT_APP.capabilities.map((c, i) => (
                        <span key={c.title}>
                            {i > 0 && " · "}
                            {c.title} — {c.body.replace(/\.$/, "")}
                        </span>
                    ))}
                </p>

                <p>
                    <span className="font-medium text-foreground">Signing in: </span>
                    {ABOUT_APP.signInNote}{" "}
                    <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                        Privacy policy
                    </Link>
                </p>

                {/* Statutory identity — the Indian equivalent of the CIN line
                    Flipkart carries in its footer. */}
                <p>
                    Registered office: {COMPANY_DETAILS.address.line1}
                    {COMPANY_DETAILS.address.line2 ? `, ${COMPANY_DETAILS.address.line2}` : ""},{" "}
                    {COMPANY_DETAILS.address.city}, {COMPANY_DETAILS.address.state}{" "}
                    {COMPANY_DETAILS.address.pin}, {COMPANY_DETAILS.address.country} · GSTIN{" "}
                    {COMPANY_DETAILS.tax.gstin} · Telephone {COMPANY_DETAILS.contact.phone}
                </p>
            </div>
        </section>
    );
}
