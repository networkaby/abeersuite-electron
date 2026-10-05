import NativeAppReady from "@/modules/mobile/components/NativeAppReady";

/** Every phone-app page — install, sign-in and the app itself — gets the Android
 *  app's ready signal and the persistent-storage request. */
export default function PhoneAppLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <NativeAppReady />
            {children}
        </>
    );
}
