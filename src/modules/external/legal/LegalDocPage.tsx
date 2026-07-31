import Link from "next/link";
import { LEGAL_DOCS, type LegalDoc, type LegalSection } from "@/shared/lib/legal/legalContent";

/**
 * Renders one legal document (/privacy, /terms, /refunds, /shipping).
 *
 * All four are the same shape — title, lede, dated sections of prose — so they
 * share one renderer. The prose itself lives in `legalContent.ts`; nothing here
 * should carry wording.
 */

function formatUpdated(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
    });
}

/**
 * A section's body is a flat list of paragraphs where "- " marks a bullet.
 * Group consecutive bullets so they render as one list.
 */
type Block = { kind: "para"; text: string } | { kind: "list"; items: string[] };

function toBlocks(body: string[]): Block[] {
    return body.reduce<Block[]>((blocks, line) => {
        if (!line.startsWith("- ")) {
            blocks.push({ kind: "para", text: line });
            return blocks;
        }
        const item = line.slice(2);
        const last = blocks[blocks.length - 1];
        if (last?.kind === "list") last.items.push(item);
        else blocks.push({ kind: "list", items: [item] });
        return blocks;
    }, []);
}

function Section({ section, index }: { section: LegalSection; index: number }) {
    return (
        <section className="scroll-mt-20" id={`s${index + 1}`}>
            <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
                {index + 1}. {section.heading}
            </h2>
            <div className="mt-3 space-y-3">
                {toBlocks(section.body).map((block, i) =>
                    block.kind === "para" ? (
                        <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                            {block.text}
                        </p>
                    ) : (
                        <ul key={i} className="space-y-2 pl-5">
                            {block.items.map((item) => (
                                <li
                                    key={item}
                                    className="list-disc text-sm leading-relaxed text-muted-foreground marker:text-muted-foreground/60"
                                >
                                    {item}
                                </li>
                            ))}
                        </ul>
                    )
                )}
            </div>
        </section>
    );
}

export default function LegalDocPage({ doc }: { doc: LegalDoc }) {
    const others = LEGAL_DOCS.filter((d) => d.slug !== doc.slug);

    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
            <header className="border-b border-border/70 pb-6">
                <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{doc.title}</h1>
                <p className="mt-2 text-sm text-muted-foreground sm:text-base">{doc.summary}</p>
                <p className="mt-4 text-xs text-muted-foreground">
                    Last updated{" "}
                    <time dateTime={doc.lastUpdated}>{formatUpdated(doc.lastUpdated)}</time>
                </p>
            </header>

            {/* Jump list — long documents are hard to scan on a phone. */}
            <nav aria-label="On this page" className="mt-6 rounded-lg border border-border/70 bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    On this page
                </p>
                <ol className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {doc.sections.map((section, i) => (
                        <li key={section.heading}>
                            <a
                                href={`#s${i + 1}`}
                                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                            >
                                {i + 1}. {section.heading}
                            </a>
                        </li>
                    ))}
                </ol>
            </nav>

            <div className="mt-8 space-y-8">
                {doc.sections.map((section, i) => (
                    <Section key={section.heading} section={section} index={i} />
                ))}
            </div>

            <footer className="mt-12 border-t border-border/70 pt-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Related policies
                </p>
                <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                    {others.map((other) => (
                        <li key={other.slug}>
                            <Link
                                href={`/${other.slug}`}
                                className="text-sm text-primary underline-offset-4 hover:underline"
                            >
                                {other.title}
                            </Link>
                        </li>
                    ))}
                </ul>
            </footer>
        </div>
    );
}
