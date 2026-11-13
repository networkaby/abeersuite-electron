import { ExternalLink } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { APP_SETTING_DEFS, APP_SETTING_SECTIONS } from "@/shared/lib/constants/appSettings";
import { ENV_ONLY_PROVIDERS, HELP_CHECKED_ON, PROVIDER_HELP } from "@/shared/lib/constants/appSettingsHelp";
import { CloseTabButton } from "@/modules/settings/components/CloseTabButton";

export const metadata = { title: "App Settings help" };

const anchor = (provider: string) => provider.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Every service, in the page's section order: editable cards first, then .env-only ones. */
const SECTIONS = APP_SETTING_SECTIONS.map((section) => {
    const editable = [...new Set(APP_SETTING_DEFS.filter((d) => d.section === section).map((d) => d.provider))];
    const envOnly = ENV_ONLY_PROVIDERS.filter((p) => p.section === section).map((p) => p.provider);
    return { section, providers: [...editable, ...envOnly].filter((p) => PROVIDER_HELP[p]) };
}).filter((s) => s.providers.length);

const ENV_ONLY = new Set(ENV_ONLY_PROVIDERS.map((p) => p.provider));

/** One page for every service: what the provider calls each value, where to get it, a link.
 *  Opened from the Help button beside Save, in its own tab. */
export default function AppSettingsHelpPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-4xl space-y-8 px-6 pt-4 pb-16">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h1 className="text-xl font-semibold">App Settings help</h1>
                        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                            For each service: what it calls the value on its own site, where to get it, and the .env key to put it under. Steps checked on{" "}
                            {HELP_CHECKED_ON}; if a menu has moved, each service&apos;s link still opens its own page.
                        </p>
                    </div>
                    <CloseTabButton />
                </div>

                <nav className="space-y-3 rounded-xl border bg-card p-4">
                    {SECTIONS.map((s) => (
                        <div key={s.section} className="grid gap-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
                            <span className="font-medium">{s.section}</span>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                                {s.providers.map((p) => (
                                    <a key={p} href={`#${anchor(p)}`} className="text-primary hover:underline">{p}</a>
                                ))}
                            </div>
                        </div>
                    ))}
                </nav>

                {SECTIONS.map((s) => (
                    <section key={s.section} className="space-y-4">
                        <h2 className="flex items-center gap-3 text-lg font-semibold">
                            {s.section}
                            <span className="h-px flex-1 bg-border" />
                        </h2>
                        {s.providers.map((p) => {
                            const help = PROVIDER_HELP[p];
                            return (
                                <article key={p} id={anchor(p)} className="scroll-mt-4 space-y-4 rounded-2xl border bg-card p-5">
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div>
                                            <h3 className="text-base font-semibold">{p}</h3>
                                            <p className="text-sm text-muted-foreground">{help.about}</p>
                                        </div>
                                        {ENV_ONLY.has(p) && <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">.env only</span>}
                                    </div>

                                    <div className="divide-y rounded-lg border">
                                        {help.terms.map((t) => (
                                            <div key={t.key} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                                                <code className="break-all text-xs font-medium">{t.key}</code>
                                                <span className="text-sm">{t.theirs}</span>
                                            </div>
                                        ))}
                                    </div>

                                    <ol className="space-y-2">
                                        {help.steps.map((step, i) => (
                                            <li key={i} className="flex gap-3 text-sm">
                                                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
                                                <span className="pt-0.5">{step}</span>
                                            </li>
                                        ))}
                                    </ol>
                                    {help.note && <p className="rounded-lg bg-muted px-3 py-2 text-sm">{help.note}</p>}

                                    <a
                                        href={help.link.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                                    >
                                        <ExternalLink size={14} /> Open {help.link.label}
                                    </a>
                                </article>
                            );
                        })}
                    </section>
                ))}
            </div>
        </ScrollArea>
    );
}
