# v1.9.3 [urgent]

An urgent update for every counter and the office app. Missed calls now stay on the call popup until someone calls the customer back, and every counter now sees the calls nobody picked up. The cash drawer can open by itself when a bill that took cash prints, and the product preview in E-Commerce opens inside the app instead of showing "page not found". There is no database change. Every counter shows an update box and installs within 30 minutes, so finish the bill in hand and restart when it asks.

**After it installs:** on a counter with a cash drawer, open **Settings → Thermal Printer**, press **Open Drawer** once to check the wiring, then tick **Open the cash drawer when a bill prints** and save. The tick is per PC and starts off, so nothing changes until you tick it.

## Calls — follow-up popup
- **A missed call stays open until someone calls back.** It shows in red with "Missed call — call back to the caller", and has no note, ticket or save until then. So a missed customer is not forgotten.
- **It closes by itself** when someone really talks to that caller (one save then covers both calls), or when the customer gets a bill or a ticket after the missed call. To close one by hand, add a note on **CRM → Call Log**.
- **A call under 2 seconds now counts as missed**, the same on the popup, the Call Log, the customer's history and Reconnect.
- **The popup shows which extension took the call**, for example "· Ext 21", because the popup can now show on other counters too.
- **Which counter sees which call:** your own extension's calls at once. A call nobody answered, or on an extension no counter uses, shows on every counter at once. Another counter's call shows everywhere after 30 minutes if it is still open. An office PC with no counter no longer shows every till's calls at once.

## Counter — cash drawer
- **The drawer opens when a bill that moved cash prints.** A new Sale, Rcv or order advance opens it when cash was taken or change was given. Every Exp opens it. A Sale Return opens it only when the refund is in cash.
- **It stays shut for UPI-only and card-only bills**, for edits, and for every reprint (Sales Register, Day Book, receipt pages).
- **The drawer opens as the slip starts printing**, and still opens if the printer is out of paper.
- Works with LAN, USB and COM receipt printers. A counter printing through the browser (no bridge) cannot open the drawer; use the Windows printer driver's own drawer option there.

## E-Commerce
- **Product preview opens inside the app.** On the product page, the photo, name and **Details** on the live preview card, and the preview icon on the Products list, open a new window showing the full product page — no sidebar, the same price and stock a customer sees. Draft products open too, with a "not published yet" strip. Before this, it showed "page not found" in the app.
- **Open in shop** appears for a published product. It opens the product on the real shop website in your browser.
- **Customize Home → View storefront** and **Ads → Preview on shop** open the website in your browser instead of "page not found" in the app. The empty ad-slot boxes show only to staff signed in on the office website; everyone else sees the live ads.
