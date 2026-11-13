# v1.17.5

An important update for every counter — please install it as soon as it appears. It brings a new App Settings page and a small database change, so the counter must be updated before the office website goes live with it; until a counter is updated its sync pauses.

## App Settings (new page)

- Settings → **App Settings** now holds the shop's service keys and ids in one place — WhatsApp numbers, Meta, Razorpay, Pine Labs, couriers, OTP, email, Cloudinary, Google Business, Facebook, Dropbox / GitHub backup and more.
- One card per provider, grouped by purpose, each with a **Ready / Missing** badge, so you can see at a glance what is set up.
- Secret keys can be saved too. They are stored locked and never shown back on screen. Anything left blank still uses the server's own setting.
- Each card shows whether its value comes from App Settings or from the server, and a **Help** button opens step-by-step instructions for that provider.

## WhatsApp

- A **Pending** WhatsApp number can now be registered from the app, and a Connected number's 2-step PIN can be changed — the PIN is typed by staff and not stored.
- Bill messages can be sent from a number that sits in another WhatsApp business account.
- Fixed: WhatsApp messages failed to send after keys moved to App Settings.
- On the counter, **Connect number** now opens the office website, because Meta sign-in needs it.

## Online shop

- **Pine Labs** is added as a payment option for the shop's checkout. It stays in test mode until a trial payment is checked.

## Pricing

- A new product given a sell price now sells on its computed price; the saved price is used only until a cost is entered.
