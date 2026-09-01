"use client";

import { Cloud, CloudOff } from "lucide-react";
import { useCounterMode } from "@/shared/hooks/useCounterMode";
import { shellStatus, type StatusField } from "@/shared/lib/counter/statusLabels";

/**
 * Where this counter is reading from and writing to, always visible while the app
 * is on one.
 *
 * TWO FIELDS, because they are two independent dials. `READ_MODE` and `WRITE_MODE`
 * are set separately and all four combinations are legal — a till reading its own
 * replica while writing straight to Supabase is a supported configuration, and one
 * blended word could not describe it. The badge used to print a single "Local" or
 * "Live" and simply lost that information.
 *
 * The words and the colour come from `shellStatus()`, shared with the Electron
 * window title so the two can never disagree. See statusLabels.ts for what each
 * word means and why "Local" stays "Local" when the connection drops.
 */
export default function CounterStatusBadge() {
    const status = useCounterMode();

    if (!status || !status.isCounter) return null;

    const { read, write, offline } = shellStatus(status);

    const sourceNote = status.replicaSource === "installed"
        ? " Running against the PostgreSQL already installed on this PC."
        : status.replicaSource === "embedded"
            ? " Running against this app's own embedded PostgreSQL."
            : "";

    const title = offline
        ? `No connection to the server. Reads are being served from this computer's own copy, which may be behind. `
        + `${write.word === "Local"
            ? "Saving works as normal — it goes to this computer and uploads when the connection returns."
            : "Only the actions enabled in Offline Policies can be saved until the connection returns."}`
        : `Connected. Reads come from ${read.word === "Local" ? "this computer's own copy, which keeps itself up to date" : "the server"}. `
        + `Saves go to ${write.word === "Local" ? "this computer and upload straight away" : "the server"}.${sourceNote}`;

    return (
        <span
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-medium dark:border-slate-700 dark:bg-slate-900"
            title={title}
            aria-label={`Reading ${read.word}, writing ${write.word}${offline ? ", server unreachable" : ""}`}
        >
            {offline
                ? <CloudOff className="size-3.5 text-rose-600 dark:text-rose-400" aria-hidden />
                : <Cloud className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />}
            <Field label="R" field={read} />
            <span className="text-slate-400 dark:text-slate-600" aria-hidden>·</span>
            <Field label="W" field={write} />
        </span>
    );
}

/**
 * One dial. The label is a single letter because the top bar has very little room
 * and this sits next to the sync badge; the tooltip and aria-label carry the full
 * sentence for anyone who needs it.
 */
function Field({ label, field }: { label: string; field: StatusField }) {
    const tone = field.tone === "down"
        ? "text-rose-700 dark:text-rose-300"
        : "text-emerald-700 dark:text-emerald-300";
    return (
        <span className={tone}>
            <span className="opacity-60">{label}:</span> {field.word}
        </span>
    );
}
