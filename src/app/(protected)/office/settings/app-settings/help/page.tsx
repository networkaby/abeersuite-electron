import { ExternalLink } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HELP_CHECKED_ON, PROVIDER_HELP } from "@/shared/lib/constants/appSettingsHelp";
import { CloseTabButton } from "@/modules/settings/components/CloseTabButton";

export const metadata = { title: "App Settings help" };

/** Opened from a card's (?) in a new tab: what the provider calls each value and where to get it. */
export default async function AppSettingsHelpPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
    const { p = "" } = await searchParams;
    const help = PROVIDER_HELP[p];
    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-3xl space-y-6 px-6 pt-4 pb-10">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">App Settings help</div>
                        <h1 className="text-xl font-semibold">{help ? p : "No help for this card"}</h1>
                        {help && <p className="mt-1 text-sm text-muted-foreground">{help.about}</p>}
                    </div>
                    <CloseTabButton />
                </div>

                {help && (
                    <>
                        <section className="space-y-2">
                            <h2 className="font-semibold">What they call it</h2>
                            <div className="divide-y rounded-xl border">
                                {help.terms.map((t) => (
                                    <div key={t.key} className="grid gap-1 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                                        <code className="break-all text-xs font-medium">{t.key}</code>
                                        <span className="text-sm">{t.theirs}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-muted-foreground">The left name is the .env key — paste the value under that name in .env / Vercel, or into the box on App Settings.</p>
                        </section>

                        <section className="space-y-2">
                            <h2 className="font-semibold">Where to get it</h2>
                            <ol className="space-y-2">
                                {help.steps.map((s, i) => (
                                    <li key={i} className="flex gap-3 text-sm">
                                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
                                        <span className="pt-0.5">{s}</span>
                                    </li>
                                ))}
                            </ol>
                            {help.note && <p className="rounded-lg bg-muted px-3 py-2 text-sm">{help.note}</p>}
                        </section>

                        <a
                            href={help.link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted"
                        >
                            <ExternalLink size={14} /> Open {help.link.label}
                        </a>

                        <p className="text-xs text-muted-foreground">
                            Steps checked on {HELP_CHECKED_ON}. If a menu has moved, the link above still opens the provider&apos;s own page.
                        </p>
                    </>
                )}
            </div>
        </ScrollArea>
    );
}
