"use client";

import { useMemo } from "react";

// One preview link per File for as long as the File lives — every screen that
// shows it shares the same link, and a re-run (React's dev double run, a hot
// reload) can never leave one holding a released link. The few photos a form
// holds cost far less than a broken preview.
const links = new WeakMap<File, string>();

const linkFor = (f: File) => {
    let u = links.get(f);
    if (!u) {
        u = URL.createObjectURL(f);
        links.set(f, u);
    }
    return u;
};

/** Local preview links for files not uploaded yet, one per file, in order. */
export function useObjectUrls(files: readonly File[]): string[] {
    return useMemo(() => files.map(linkFor), [files]);
}
