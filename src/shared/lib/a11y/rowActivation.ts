import type { KeyboardEvent, MouseEvent } from "react";

/**
 * Pattern E — "drill-downs the keyboard cannot reach".
 *
 * Nearly every drill-down in the books and the BI reports was an `onClick` on a
 * `<tr>` or a `<td>`, with no role and no tab stop. A keyboard user could not
 * open a single one of them.
 *
 * The RIGHT fix is a real `<button>` in the first cell — a screen reader then
 * announces the row's name as the thing being activated, which a whole clickable
 * row can never do. Reach for `<button>` first.
 *
 * This helper is for the case where that is a large rewrite of a table that is
 * otherwise fine: it makes an existing clickable row properly operable — focusable,
 * announced as a control, and activated by Enter and Space like any button.
 *
 *     <tr {...rowActivation(() => openLedger(row.id), `Open ledger ${row.name}`)}>
 *
 * Space is preventDefault-ed because its default on a focused element is to scroll
 * the page, which would jump the table away under the user at the moment they act.
 */
export function rowActivation(
    onActivate: () => void,
    label: string,
    opts: { disabled?: boolean } = {},
): {
    role: "button";
    tabIndex: number;
    "aria-label": string;
    "aria-disabled"?: true;
    onClick: (e: MouseEvent) => void;
    onKeyDown: (e: KeyboardEvent) => void;
} {
    const disabled = opts.disabled === true;
    return {
        role: "button",
        tabIndex: disabled ? -1 : 0,
        "aria-label": label,
        ...(disabled ? { "aria-disabled": true as const } : {}),
        onClick: () => {
            if (!disabled) onActivate();
        },
        onKeyDown: (e: KeyboardEvent) => {
            if (disabled) return;
            if (e.key !== "Enter" && e.key !== " ") return;
            // A control INSIDE the row (a checkbox, a menu button) gets the key first.
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            onActivate();
        },
    };
}

/**
 * Same contract for an expand/collapse control, which additionally has to say
 * whether it is currently open.
 *
 * Use on the toggle itself, never on the whole row: a row that both navigates and
 * expands cannot announce which one Enter will do.
 */
export function disclosureActivation(
    onToggle: () => void,
    expanded: boolean,
    label: string,
): {
    role: "button";
    tabIndex: number;
    "aria-label": string;
    "aria-expanded": boolean;
    onClick: (e: MouseEvent) => void;
    onKeyDown: (e: KeyboardEvent) => void;
} {
    return {
        ...rowActivation(onToggle, label),
        "aria-expanded": expanded,
    };
}
