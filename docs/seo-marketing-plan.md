# Shop SEO, Marketing & Tracking — Full To-Do List

> Scope: **shop build only** (`APP_MODE=public`). The office, full and counter builds stay hidden, and none of this runs there.
> Order: **my suggestion first**, then everything else from **high → low** priority.
> Effort: **S** = under 1 hour · **M** = half a day · **L** = 1–3 days · **Ongoing** = regular work by the owner or staff.
> Owner: **Code** = I build it · **You** = an account, setup or content job for you.

---

## 0. Already in place (no work needed)

| Item | Where |
|---|---|
| Office build hidden: `robots.txt` blocks all, `noindex` meta tag, `X-Robots-Tag` header, empty sitemap | `src/app/robots.ts`, `src/app/layout.tsx`, `next.config.ts` |
| Shop `robots.txt` lets crawlers in but blocks `/office /staff /api /portal /receipt` and the other private paths | `src/app/robots.ts` |
| Sitemap with the home page, `/shop`, login and the legal pages | `src/app/sitemap.ts` |
| Schema: `Organization`, `WebSite`, `Store`, `Product` + `Offer` (with availability and category) | `src/shared/lib/seo/jsonLd.ts` |
| Page titles, descriptions and Open Graph on the store, product, legal and `[slug]` pages | each `page.tsx` |
| Open Graph share image | `src/app/(external)/opengraph-image.tsx` |
| Web manifest | `src/app/shop.webmanifest` |

---

## ⭐ 1. My suggestion — do these first (biggest gain for the least work)

| # | Task | Why it matters | Effort | Owner |
|---|---|---|---|---|
| 1 | **Google Search Console + Bing Webmaster**: add the verification tags (from `.env`) and submit the sitemap | Without this we cannot see how Google treats the shop. It is free. | S | Code + You |
| 2 | **Put every product (and category) in the sitemap.** Read them with one DB query and cache the result for 1 hour. | Google finds new products in days instead of weeks | S | Code |
| 3 | **Google Merchant Center product feed** at `/feed/google.xml`: id, title, price, sale price, stock, image, brand, GTIN, link. Cached. | Gets us **free product listings** in Google Shopping and is required for Shopping ads | M | Code + You |
| 4 | **Google Analytics 4**, shop build only, loaded after the page | Shows visitors, traffic sources and sales | S | Code + You |
| 5 | **E-commerce events**: `view_item`, `add_to_cart`, `begin_checkout`, `purchase` (including order value) | Shows which products sell and where buyers drop off | M | Code |
| 6 | **Google Business Profile**: same name, address and phone as the site; photos; opening hours | Local "near me" searches bring the most walk-in and nearby buyers | S | You |
| 7 | **Canonical URL on every shop page**, and filter or sort URLs (`?sort=`, `?page=`) pointed at the clean URL | Stops duplicate pages from splitting our ranking | S | Code |
| 8 | **Richer Product schema**: `brand`, `sku`, `gtin`, `priceValidUntil`, `itemCondition`, shipping and return policy | Needed for the Google "rich result" with price, stock and delivery shown in search | S | Code |
| 9 | **BreadcrumbList schema** + visible breadcrumbs (Home › Category › Product) | Search results show a clean path, and more people click | S | Code |
| 10 | **Cookie / consent notice** with Google Consent Mode v2 | Legal safety under India's DPDP Act; also needed for ads in Europe | S | Code |

---

## 2. High priority — technical and on-page SEO

| # | Task | Effort | Owner |
|---|---|---|---|
| 11 | Category / collection pages with their own URL, H1, a 100–200 word intro, and indexed | M | Code + You |
| 12 | Unique title and meta description for each product, with a template fallback (`{name} – {brand} \| Buy online at {store}`) | S | Code |
| 13 | Product image `alt` text taken from product name + colour/variant | S | Code |
| 14 | Core Web Vitals: `next/image` sizes, AVIF/WebP, preload the main image, no layout shift, LCP under 2.5 s on mobile | M | Code |
| 15 | Out-of-stock products: keep the page live and mark it "OutOfStock". Do not show a 404 error. Deleted products: send a 301 redirect to the category. | S | Code |
| 16 | `noindex` on cart, checkout, wishlist, compare, order, login and search-result pages | S | Code |
| 17 | Proper 404 page with links to search and popular products (exists; check its status code is 404) | S | Code |
| 18 | `hreflang` / `lang="en-IN"` and currency INR in schema | S | Code |
| 19 | Internal linking: "Related products", "Customers also bought" and "More from this brand" on each product page | M | Code |
| 20 | Faceted filters: crawlable links for the main categories only; other filter mixes `noindex` | M | Code |
| 21 | Check that the HTTPS → www (or non-www) redirect has a single hop; HSTS header | S | Code |
| 22 | Image sitemap entries (product images) | S | Code |

## 3. High priority — schema (structured data)

| # | Schema | Where | Effort |
|---|---|---|---|
| 23 | `Product` + `Offer` (extend: brand, sku, gtin13, priceValidUntil, `hasMerchantReturnPolicy`, `shippingDetails`) | Product page | S |
| 24 | `AggregateRating` + `Review` (only with real reviews) | Product page | M (needs the review feature, #44) |
| 25 | `BreadcrumbList` | All shop pages | S |
| 26 | `ItemList` | Category and `/shop` pages | S |
| 27 | `LocalBusiness` / `Store` with `openingHoursSpecification`, `geo`, `sameAs` (social links) | Home | S |
| 28 | `FAQPage` | Product and help pages that carry real FAQs | S |
| 29 | `WebSite` + `SearchAction` (sitelinks search box) | Home | S |
| 30 | `OfferShippingDetails`, `MerchantReturnPolicy` at organisation level | Organisation | S |
| 31 | Check everything in the Rich Results Test and the Schema.org validator; add a CI check | — | S |

## 4. High priority — product feeds

| # | Feed | Effort | Owner |
|---|---|---|---|
| 32 | Google Merchant Center (XML / RSS 2.0) — see #3 | M | Code |
| 33 | Meta (Facebook / Instagram Shop) catalogue feed (CSV / XML, same data) | S (after #32) | Code |
| 34 | Merchant Center **local inventory** feed (stock per shop), for the "in stock near you" label | M | Code |
| 35 | Pinterest catalogue feed | S | Code |
| 36 | Feed health: exclude products with no image, price or stock; daily refresh via cache | S | Code |

## 5. Medium priority — analytics and tracking

| # | Task | Effort | Owner |
|---|---|---|---|
| 37 | Meta Pixel + **Conversions API** (sent from the server, works even with ad blockers) | M | Code + You |
| 38 | Google Ads conversion tag + enhanced conversions | S | Code + You |
| 39 | UTM tags saved on the order (where the sale came from) and shown in the office ecommerce reports | M | Code |
| 40 | Microsoft Clarity (free heatmaps and session recordings) | S | Code + You |
| 41 | Search-term logging for the shop search ("searched but found nothing" report) | S | Code |
| 42 | Monthly SEO dashboard: Search Console + GA4 in Looker Studio (free) | S | You |
| 43 | Uptime monitor for the shop domain (UptimeRobot, free) | S | You |

## 6. Medium priority — conversion and trust (helps ranking too)

| # | Task | Effort | Owner |
|---|---|---|---|
| 44 | **Product reviews and ratings** (verified buyers only, moderated in the office) | L | Code |
| 45 | Clear delivery time, COD and return info on the product page | S | Code |
| 46 | WhatsApp chat button + WhatsApp order updates | M | Code + You |
| 47 | Abandoned cart reminder (SMS / WhatsApp / email) | L | Code |
| 48 | Back-in-stock alert | M | Code |
| 49 | Trust badges: secure payment, GST number, real address, phone | S | Code |
| 50 | Fast mobile checkout: guest checkout, UPI first, address autofill by PIN code | M | Code |
| 51 | PWA "Add to home screen" (manifest exists; add install prompt + offline page) | S | Code |
| 52 | Web push notifications for offers (opt-in) | M | Code |

## 7. Medium priority — content (on-page)

| # | Task | Effort | Owner |
|---|---|---|---|
| 53 | Write original product descriptions (not the manufacturer copy) for the top 50 sellers first | Ongoing | You |
| 54 | Blog / guides section (`/blog`): buying guides, "how to choose", comparisons, `Article` schema | L, then Ongoing | Code + You |
| 55 | About Us page with the real story, team and shop photos (E-E-A-T — Google's trust signals) | S | You |
| 56 | Keyword research: Google Keyword Planner, Search Console queries; target local + product-type terms ("{product} shop in {city}") | Ongoing | You |
| 57 | City / area landing pages (only if we truly deliver there) | M | Code + You |
| 58 | Video on product pages (YouTube embed + `VideoObject` schema) | Ongoing | You |
| 59 | Hindi / regional-language pages, if customers search that way | L | Code + You |

## 8. Lower priority — off-page SEO and marketing

| # | Task | Effort | Owner |
|---|---|---|---|
| 60 | Same name / address / phone (NAP) listed on Justdial, IndiaMART, Sulekha, Bing Places, Apple Maps | S each | You |
| 61 | Ask happy buyers for **Google reviews** (QR code on the printed bill via the print template, link in the order SMS) | S + Ongoing | Code + You |
| 62 | Social profiles (Instagram, Facebook, YouTube, Pinterest) linked from the site and in `sameAs` | S | You |
| 63 | Backlinks: local news, supplier/brand "where to buy" pages, local directories, chamber of commerce | Ongoing | You |
| 64 | Influencer / creator tie-ups with trackable coupon codes | Ongoing | You |
| 65 | Google Shopping (Performance Max) ads once the feed is clean | Ongoing | You |
| 66 | Meta ads with catalogue retargeting (needs #33 + #37) | Ongoing | You |
| 67 | Email / WhatsApp newsletter with opt-in at checkout | M | Code + You |
| 68 | Referral program ("give ₹100, get ₹100") | L | Code |
| 69 | Marketplace presence (Amazon / Flipkart / ONDC) for brand searches | L | You |
| 70 | Google Posts on the Business Profile every week | Ongoing | You |

## 9. Low priority — nice to have

| # | Task | Effort |
|---|---|---|
| 71 | `llms.txt` and clean product data for AI search (ChatGPT, Gemini, Perplexity) | S |
| 72 | IndexNow ping to Bing/Yandex when a product changes | S |
| 73 | `security.txt`, `humans.txt` | S |
| 74 | A/B tests on product page layout (after enough traffic) | M |
| 75 | Visual search / image-based "similar products" | L |

---

## Keep in mind (common mistakes)

- ❌ Never set `APP_MODE=public` on the office Vercel project — it would invite Google into the office.
- ❌ No tracking script on the office or counter builds.
- ❌ Never add fake reviews or ratings to schema — Google penalises the whole site.
- ❌ Feed price must match the page price exactly, or Merchant Center blocks the products.
- ❌ Do not `noindex` out-of-stock products — keep them and mark them out of stock.
- ✅ Everything from the DB (sitemap, feed) is cached, as per our cost rule.
- ✅ Every tracking ID comes from `.env`; if it is empty, nothing loads.
