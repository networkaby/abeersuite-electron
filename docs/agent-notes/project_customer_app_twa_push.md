---
name: project_customer_app_twa_push
description: "Customer app is Capacitor (shop-app-native/) since 2026-10-08 with native FCM; the first TWA (shop-app/) is retired but its keystore still signs."
metadata:
  type: project
---

Started 2026-10-06 as a Bubblewrap TWA (`shop-app/`) for web push + "shown" ack. Replaced 2026-10-08 by a Capacitor shell (`shop-app-native/`, same package `in.networkservice.shop`, opens shop.networkservice.in/m-shop-app, UA `NSShopApp`), with native FCM (NsMessagingService posts the "shown" ack). `public/ns-shop.apk` is that Capacitor build (checked 2026-10-17). Staff app is Capacitor too (`phone-app/`).

**Why:** the owner asked for full native feel; native FCM solved the "shown" report that first ruled Capacitor out.

**How to apply:** treat both apps as Capacitor (update bar, push via FCM). The signing key is still `shop-app/ns-shop.keystore` (staff key's password) — never make a new one. VAPID keys in `.env`, never rotate. Related: [project_app_update_prompt](project_app_update_prompt.md), [project_d_office_triggers_vercel_deploy](project_d_office_triggers_vercel_deploy.md).
