"use client";

import MessageAlertPopup from "@/modules/message/components/MessageAlertPopup";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";
import { MOBILE_SCREENS, holdsScreen } from "../lib/mobileScreens";

const INBOX = MOBILE_SCREENS.find((s) => s.href === `${PHONE_APP_HOME}/inbox`)!;

/**
 * The office's WhatsApp message popup, inside the staff phone app: same cards,
 * chime and reply box, but "open the chat" goes to the app's own Inbox and the
 * Inbox tick decides who sees it. Notifications with the app closed come from
 * the Android shell (FCM, push/staffPush.ts).
 */
export default function MobileMessageAlert() {
    return <MessageAlertPopup href={INBOX.href} mayOpen={(p) => holdsScreen(p, INBOX)} />;
}
