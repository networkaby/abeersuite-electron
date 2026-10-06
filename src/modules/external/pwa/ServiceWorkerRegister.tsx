"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/modules/external/pwa/pushClient";

/** Registers the customer app's service worker (public/sw.js) once per visit. */
export default function ServiceWorkerRegister() {
    useEffect(() => {
        void registerServiceWorker();
    }, []);
    return null;
}
