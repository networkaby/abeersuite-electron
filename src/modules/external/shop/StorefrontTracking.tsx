import Script from "next/script";
import { loadTrackingCodes } from "@/shared/lib/shop/trackingCodes.server";
import CustomTrackingHtml from "./CustomTrackingHtml";

/**
 * Settings → Tracking Codes, on the shop pages only (StorefrontChrome). The ids
 * are already checked against TRACKING_ID_PATTERNS by normalizeTrackingCodes, so
 * putting them inside inline script is safe. Codes are cached
 * (loadTrackingCodes), so this adds no DB read per visit.
 */
export default async function StorefrontTracking() {
    const c = await loadTrackingCodes();
    const ga4 = c.ga4Enabled && c.ga4Id;
    const gtm = c.gtmEnabled && c.gtmId;
    const meta = c.metaPixelEnabled && c.metaPixelId;
    const tiktok = c.tiktokPixelEnabled && c.tiktokPixelId;
    const custom = c.customEnabled && (c.customHead.trim() || c.customBody.trim());

    return (
        <>
            {ga4 && (
                <>
                    <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga4}`} strategy="afterInteractive" />
                    <Script id="tc-ga4" strategy="afterInteractive">
                        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ga4}');`}
                    </Script>
                </>
            )}
            {gtm && (
                <Script id="tc-gtm" strategy="afterInteractive">
                    {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtm}');`}
                </Script>
            )}
            {meta && (
                <Script id="tc-meta" strategy="afterInteractive">
                    {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${meta}');fbq('track','PageView');`}
                </Script>
            )}
            {tiktok && (
                <Script id="tc-tiktok" strategy="afterInteractive">
                    {`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=d.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${tiktok}');ttq.page();}(window,document,'ttq');`}
                </Script>
            )}
            {custom && <CustomTrackingHtml head={c.customHead} body={c.customBody} />}
        </>
    );
}
