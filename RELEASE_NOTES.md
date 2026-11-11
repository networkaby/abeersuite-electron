# v1.17.3

Every counter should install this one. It fixes counters that showed **Copy incomplete** after a shop product was moved to the Attention stage — their product list stopped refreshing until this update. No database change.

## Counter sync

- Fixed: a counter that already had the product list could not copy products in the new Attention stage, so the whole product list stopped updating. It now catches up by itself after the update.

## Stock

- A nightly check now finds stock totals that no longer match their entries and corrects them, so a published product is no longer held back as Pending by a wrong total.

## Online shop products

- **Generate with AI** now also picks collections, brand, shipping weight and parcel size, product codes, and writes notes for staff to check.
- The AI Specs preview shows only the specs the product is still missing.

## Inventory

- Every inventory master list now has a search box.
- In the Item Ledger, right-click an entry to open its invoice or party in a new window, as in the Day Book.

## Small fixes

- The Add service list on vouchers is no longer cut off by the item table.
- The messages popup now shows both sides of the chat and keeps its header on screen.
- Dates are shown the same way on every screen.
