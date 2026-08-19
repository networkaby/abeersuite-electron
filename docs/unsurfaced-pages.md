# Unsurfaced Pages

**Last Updated:** 2026-08-19  
**Total Unsurfaced:** 34 pages

Pages that exist in `src/app/` but are not linked from the sidebar navigation or main app UI.

---

## Intentional (Not in Nav by Design)

### Legal & Policy Pages (4)
Footer links, not main navigation:
- `/privacy` — Privacy policy
- `/refunds` — Refund policy  
- `/shipping` — Shipping information
- `/terms` — Terms & conditions

### Customer Shop (6)
E-commerce storefront (separate app layer):
- `/cart` — Shopping cart
- `/checkout` — Checkout flow
- `/compare` — Product comparison
- `/order` — Order detail/tracking
- `/product` — Product detail page
- `/wishlist` — Customer saved items

### Customer Portal (12)
Self-service portal for customers (separate from staff nav):
- `/login` — Customer login
- `/portal` — Portal dashboard
- `/portal/coupons` — Apply/manage coupons
- `/portal/orders` — Order history
- `/portal/register` — Create account
- `/portal/repairs` — Repair status tracking
- `/portal/settings` — Account settings
- `/portal/social` — Reviews/social features
- `/portal/social/view` — Social item detail
- `/portal/tickets` — Support tickets
- `/portal/wallet` — Digital wallet/balance
- `/portal/wishlist` — Saved products

### Lab / Development (3)
Dev/testing pages (not for production):
- `/lab` — Lab dashboard
- `/lab/back` — Backend testing UI
- `/lab/front` — Frontend testing UI

---

## Office Pages Missing from Sidebar

### Dashboard/Entry Points (4)
**Status:** 🟡 Review — should these be in nav?

- **`/office/customers/dashboard`** — Customer analytics dashboard
  - *Question:* Should this be added to Contacts module nav?
  - *Current nav:* Only `/office/customers/person` and `/office/customers/companies`

- **`/office/accountancy/dashboard`** — Accountancy overview dashboard
  - *Question:* Should this be the default Accountancy module entry instead of reports?
  - *Current nav:* Leads to `/office/accountancy/reports`

- **`/office/accountancy/orders-estimates`** — Orders & Estimates register
  - *Question:* Why removed from nav? Still needed?
  - *Note:* Was linked before, now absent

- **`/office/customers/all`** — All contacts (flat list)
  - *Question:* Consolidate with Person + Companies sub-nav or keep separate?
  - *Current nav:* Only Person and Companies links

### Utility/Configuration (3)
**Status:** 🟡 Review — should these be surfaced?

- **`/office/inventory/configuration`** — Inventory settings/config
  - *Likely:* Should be under Settings, or internal-only link
  - *Purpose:* Inventory master configuration

- **`/office/core/search-slno`** — Search products by serial number
  - *Purpose:* Quick lookup utility
  - *Question:* Worth adding to quick actions or as utility link?

- **`/office/welcome`** — Welcome/onboarding page
  - *Question:* Is this still used as post-login entry point?
  - *Purpose:* Likely onboarding or getting-started guide

### Social Features (1)
**Status:** 🟡 Review — location unclear

- **`/office/social/users`** — Social users/reviewers management
  - *Question:* Where should customer reviews & ratings management live?
  - *Purpose:* Likely admin panel for managing reviews/ratings

---

## Staff Alternate Login (1)
**Status:** ⚠️ Unclear purpose

- **`/staff/login`** — Alternate staff login path
  - *Question:* Is this needed or duplicate of main login?
  - *Purpose:* Possibly bridge login or POS-specific login

---

## Action Items

### ✅ Verify & Document (Low Priority)
- [ ] Confirm all intentional pages are truly intentional
- [ ] Check if legal pages are linked from footer
- [ ] Verify lab pages are only in dev environment

### 🟡 Review & Decide (Medium Priority)
- [ ] Are `/office/customers/dashboard` and `/office/accountancy/dashboard` actively used?
- [ ] Should `/office/customers/all` be consolidated with Person + Companies?
- [ ] Is `/office/accountancy/orders-estimates` still relevant?

### 🔴 Clarify (High Priority)
- [ ] What is `/office/core/search-slno` used for? Should it be in main nav?
- [ ] Where does `/office/welcome` fit in the user journey?
- [ ] What is `/office/social/users` for? Should reviews management be in CRM or elsewhere?
- [ ] Is `/staff/login` a real alternate path or can it be removed?

---

## Notes

- Dynamically routed pages (with `[id]` or `[slug]`) are handled separately by their parent routes
- Receipt/shipping-label pages (`/receipt/*`, `/shipping-label/*`) are print-only and intentionally hidden
- Page routes extracted by analyzing `src/app/**/**/page.tsx` patterns
- Navigation source: `src/utils/constants.ts` (WORKSPACE_NAV, MODULE_SECTIONS, ADMIN_NAV, SETTINGS_NAV)
