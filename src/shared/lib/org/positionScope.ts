/**
 * Where a position sits in the organisation, in the words the app already uses.
 *
 * A seat belongs to a branch, and a seat with NO branch is org-wide — which this
 * business calls the **Executive Council**, the heading the Positions page and the Org
 * Chart both group those seats under. That wording is the owner's, not an invention
 * here, and it is why this is one function rather than a string repeated per screen.
 *
 * `withDepartment` gives the fuller "Head Office / Managment" the admin Positions page
 * shows. The counter's sign-in card leaves it off: a card is 151px wide and the branch
 * alone is what tells two people apart there.
 */

export interface PositionScopeSource {
    branch?: { name: string } | null;
    department?: { name: string } | null;
}

export const EXECUTIVE_COUNCIL = "Executive Council";

export function positionScopeLabel(
    position: PositionScopeSource,
    opts: { withDepartment?: boolean } = {},
): string {
    if (!position.branch) return EXECUTIVE_COUNCIL;
    return opts.withDepartment && position.department
        ? `${position.branch.name} / ${position.department.name}`
        : position.branch.name;
}
