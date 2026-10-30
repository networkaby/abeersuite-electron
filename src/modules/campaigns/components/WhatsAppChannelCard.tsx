/**
 * WhatsApp Channel and Status have no posting API, so there is nothing to
 * connect: the card only says how they are shared. Fixed facts, no status.
 */
const ROWS = [
    { title: "WhatsApp Channel", sub: "No API from Meta — an admin shares each post from their phone (Share button on the post)." },
    { title: "WhatsApp Status", sub: "Shared by hand from the company phone. Will post by itself after Meta approves the coexistence setup." },
];

export default function WhatsAppChannelCard() {
    return (
        <section className="rounded-xl border">
            <div className="border-b px-4 py-3">
                <h2 className="text-sm font-semibold">WhatsApp — shared by hand</h2>
                <p className="text-xs text-muted-foreground">Nothing to connect here.</p>
            </div>
            <div className="divide-y">
                {ROWS.map((r) => (
                    <div key={r.title} className="px-4 py-2.5">
                        <p className="text-sm">{r.title}</p>
                        <p className="text-xs text-muted-foreground">{r.sub}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}
