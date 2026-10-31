/// Counter-help page URL + open helper (F1 / the rail "?" button).
///
/// The guide is opened in a NEW tab. Some environments (kiosk browsers,
/// embedded webviews) block popups — window.open then returns null, so callers
/// fall back to an in-app navigation (router.push) to guarantee the cashier
/// always reaches the page.
export const POS_HELP_URL = "/vouchers/pos/help";

/** Open the help page in a new tab. Returns true when a tab actually opened.
 *  No "noopener" feature: with it window.open always answers null, so callers
 *  read every success as blocked and also pushed help into the POS window. The
 *  opener is cut by hand instead. */
export function openPosHelpTab(): boolean {
    const w = window.open(POS_HELP_URL, "_blank");
    if (!w) return false;
    w.opener = null;
    return true;
}
