"use client";

import { useEscapeBack } from "@/shared/hooks/useEscapeBack";

/** Esc → router.back() for an area that has no breadcrumb to hang it on.
 *  Renders nothing.
 *
 *  Where a PathBreadcrumb exists, pass `escapeBack` there instead — this is only
 *  for the few areas without one (the Workspace inboxes, a colleague's profile).
 *  Never render both for the same page: `useEscapeBack` is a
 *  plain window listener with no guard against a second copy of itself, so two
 *  would call `router.back()` twice and skip a history entry. */
export function EscapeBack() {
    useEscapeBack(true);
    return null;
}
