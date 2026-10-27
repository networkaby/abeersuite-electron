"use client";

import { useEffect } from "react";

/**
 * Puts the admin's custom tracking HTML into <head> / end of <body>. React will
 * not run a <script> set through innerHTML, so each script is rebuilt as a fresh
 * element. Runs once per visit: the storefront layout stays mounted across shop
 * navigation, and each node is tagged so a remount never adds it twice.
 */
export default function CustomTrackingHtml({ head, body }: { head: string; body: string }) {
    useEffect(() => {
        inject(head, document.head, "head");
        inject(body, document.body, "body");
    }, [head, body]);
    return null;
}

function inject(html: string, target: HTMLElement, slot: string) {
    if (!html.trim() || target.querySelector(`[data-tracking-custom="${slot}"]`)) return;
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    for (const node of Array.from(tpl.content.childNodes)) {
        let el: Node = node;
        if (node instanceof HTMLScriptElement) {
            const s = document.createElement("script");
            for (const a of Array.from(node.attributes)) s.setAttribute(a.name, a.value);
            s.text = node.text;
            el = s;
        }
        if (el instanceof Element) el.setAttribute("data-tracking-custom", slot);
        target.appendChild(el);
    }
}
