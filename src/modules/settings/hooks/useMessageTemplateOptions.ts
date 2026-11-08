"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { isWaKind, waKindLabel } from "@/shared/lib/whatsapp/billTemplates";
import { emailKindLabel, isEmailAnyKind } from "@/shared/lib/email/emailTemplates";

/** One choice in a "which template" dropdown. */
export type TemplateOption = { kind: string; name: string; ready: boolean; why: string };
export type TemplateChannel = "whatsapp" | "email";

type Row = { kind: string; name: string | null; enabled: boolean; approved?: unknown };

// One read per channel per minute, shared by every picker on the screen.
const TTL_MS = 60_000;
const cache = new Map<TemplateChannel, { at: number; promise: Promise<TemplateOption[]> }>();

function load(channel: TemplateChannel): Promise<TemplateOption[]> {
    const hit = cache.get(channel);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
    const url = channel === "whatsapp" ? "/api/settings/whatsapp-templates" : "/api/settings/email-templates";
    const promise = axios
        .get<{ templates: Row[] }>(url)
        .then(({ data }) =>
            data.templates.flatMap((t): TemplateOption[] => {
                if (channel === "whatsapp") {
                    if (!isWaKind(t.kind)) return [];
                    return [{ kind: t.kind, name: waKindLabel(t.kind, t.name), ready: t.enabled && !!t.approved, why: !t.approved ? "not approved yet" : "switched off" }];
                }
                if (!isEmailAnyKind(t.kind)) return [];
                return [{ kind: t.kind, name: emailKindLabel(t.kind, t.name), ready: t.enabled, why: "switched off" }];
            }),
        )
        .catch(() => {
            cache.delete(channel);
            return [];
        });
    cache.set(channel, { at: Date.now(), promise });
    return promise;
}

/** Every WhatsApp or email template, built-in and staff's own — no rules of
 *  its own; a screen that wants fewer filters the list itself. Read when
 *  `enabled` turns true. A template not ready yet
 *  is still listed, with the reason, so it can be picked now and switched on
 *  later. */
export function useMessageTemplateOptions(channel: TemplateChannel, enabled = true): TemplateOption[] {
    const [list, setList] = useState<TemplateOption[]>([]);
    useEffect(() => {
        if (!enabled) return;
        let live = true;
        void load(channel).then((l) => live && setList(l));
        return () => {
            live = false;
        };
    }, [channel, enabled]);
    return list;
}
