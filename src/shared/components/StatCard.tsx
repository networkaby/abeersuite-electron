// Small read-only tiles and section frames. Lifted out of the HR "My Info" page
// when the Employee Portal split it into tabs; nothing here fetches or acts.

export function StatCard({ icon, label, value, hint, tone }: {
    icon?: React.ReactNode; label: string; value: string; hint?: string;
    /** A figure that deserves a colour — money owed, a penalty, a met target. */
    tone?: "good" | "warn" | "bad";
}) {
    const toneCls = tone === "good" ? "text-emerald-700 dark:text-emerald-400"
        : tone === "warn" ? "text-amber-700 dark:text-amber-400"
        : tone === "bad" ? "text-red-700 dark:text-red-400" : "";
    return (
        <div className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}<span>{label}</span></div>
            <div className={`mt-1 text-lg font-semibold ${toneCls}`}>{value}</div>
            {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        </div>
    );
}

export function Section({ title, icon, right, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section>
            <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">{icon}{title}</h2>
                {right}
            </div>
            {children}
        </section>
    );
}

export function Fact({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-0.5 text-sm font-medium">{value}</div>
        </div>
    );
}
