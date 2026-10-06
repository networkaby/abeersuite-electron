/**
 * Legal / policy documents shown on the public site (/privacy, /terms,
 * /refunds, /shipping).
 *
 * ⚠️ DRAFT — NOT LEGALLY REVIEWED.
 * This text was drafted to describe what the application actually does, and to
 * satisfy the website checklists of Razorpay activation and Google OAuth
 * verification. It has NOT been checked by a lawyer. Have it reviewed before
 * you rely on it commercially.
 *
 * These documents cover BOTH hostnames the business is served on (see
 * `BOTH_SITES` below) — the company site and the store are one legal entity,
 * split only by how we deploy them.
 *
 * Editing: change the prose here, never in the page components. Entity name,
 * address, contact and policy numbers are read from COMPANY_DETAILS so they
 * stay single-sourced.
 */

import { formatRupees, paiseToRupees } from "@/shared/lib/format/moneyInr";
import { LEGAL_SLUGS, type LegalSlug } from "@/shared/lib/legal/legalPaths";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";

export type LegalSection = {
    heading: string;
    /** Each string is one paragraph. A string starting with "- " renders as a bullet. */
    body: string[];
};

export type LegalDoc = {
    slug: LegalSlug;
    title: string;
    /** One-line description — used as the page lede and the SEO description. */
    summary: string;
    /** ISO date (YYYY-MM-DD). Bump when you change the text. */
    lastUpdated: string;
    sections: LegalSection[];
};

const C = COMPANY_DETAILS;

const POSTAL_ADDRESS = [
    C.address.line1,
    C.address.line2,
    `${C.address.city}, ${C.address.state} ${C.address.pin}`,
    C.address.country,
]
    .filter(Boolean)
    .join(", ");

/**
 * One business, two hostnames. We deploy the company site and the store
 * separately for technical reasons only — legally and commercially they are the
 * same entity, so every document here covers both. Say this in each policy so a
 * reviewer (Google, Razorpay) or a customer is never left guessing whether a
 * policy applies to the site they happen to be on.
 */
const BOTH_SITES = `This policy covers our whole website, whichever address you reached us on — ${C.sites.company} (our main site) and ${C.sites.shop} (our online store and customer portal). Both are run by ${C.legalName}; they are one business and one legal entity, hosted separately only for technical reasons.`;

const RETURN_DAYS = C.policies.returnWindowDays;
const FREE_SHIPPING_FROM = formatRupees(paiseToRupees(C.policies.freeShippingMinPaise));

/** Bump all four documents together when you revise any of them. */
const LAST_UPDATED = "2026-10-06";

export const PRIVACY_POLICY: LegalDoc = {
    slug: "privacy",
    title: "Privacy Policy",
    summary: `How ${C.legalName} collects, uses, shares and protects your personal data.`,
    lastUpdated: LAST_UPDATED,
    sections: [
        {
            heading: "Who we are",
            body: [
                `${C.legalName} ("we", "us") is a computer hardware retail and repair business. Our registered address is ${POSTAL_ADDRESS}. Our GSTIN is ${C.tax.gstin}.`,
                BOTH_SITES,
                `For any question about your personal data, write to ${C.contact.supportEmail} or call ${C.contact.phone} during ${C.hours}.`,
                "This policy explains what we collect when you browse the store, place an order, book a repair, or sign in to the customer portal.",
            ],
        },
        {
            heading: "What we collect",
            body: [
                "- Identity and contact details: your name, mobile number, email address and postal address.",
                "- Order data: the products you buy, prices paid, GST invoice details, and any GSTIN you give us for a business purchase.",
                "- Service and repair data: the device or item you bring in, its serial number, the fault you report, our diagnosis, parts used, and warranty status.",
                "- Sign-in data: the one-time codes we send you, and — if you use Google sign-in — the name, email address and profile picture Google shares with us.",
                "- Payment data: we do NOT store your card number, UPI PIN or netbanking password. Online payments are handled by Razorpay; we keep only the payment reference, amount, status and method.",
                "- Technical data: your IP address, browser type, pages viewed, and cookies or similar local storage described below.",
                "- Communications: messages you send us over WhatsApp, email or the portal, and our replies.",
            ],
        },
        {
            heading: "How we use your data",
            body: [
                "- To take and fulfil your orders, arrange delivery, and raise a GST invoice.",
                "- To run repairs and service jobs, and to tell you the status of your job.",
                "- To sign you in and keep your account secure, including sending one-time codes.",
                "- To handle payments, refunds and returns.",
                "- To answer your questions and provide after-sales support.",
                "- To meet our legal duties under Indian tax, GST and company law.",
                "- To send you offers or reminders — only where you have not opted out. You can opt out at any time and it will not affect your orders or warranty.",
            ],
        },
        {
            heading: "Consent and your choices",
            body: [
                "We process your personal data on the basis of the consent you give when you place an order, book a repair, or create an account. Where the law requires us to keep records — for example GST invoices — we keep them even after you withdraw consent, but only for that purpose.",
                "You may withdraw your consent at any time by writing to us. Withdrawing consent will stop future processing, but it will not undo anything we have already done lawfully.",
            ],
        },
        {
            heading: "Who we share your data with",
            body: [
                "We do not sell your personal data. We share it only with service providers who help us run the business, and only with the data they need:",
                "- Razorpay — to take online payments and process refunds.",
                "- Fast2SMS — to deliver one-time codes and order updates by SMS.",
                "- Meta (WhatsApp) — to deliver one-time sign-in and verification codes on WhatsApp. Meta receives your mobile number and the code.",
                "- Resend — to deliver one-time codes, order confirmations and invoices by email.",
                "- Google / Firebase — to verify your identity if you choose Google sign-in.",
                "- Shiprocket, Shipway and our own delivery staff — to deliver your order. They receive your name, delivery address and mobile number.",
                "- Cloudinary — to store and serve product images you or we upload.",
                "- Supabase and Vercel — to host our database and application.",
                "We also share data where a law, court order or government authority requires it.",
            ],
        },
        {
            // Google's brand verification requires the privacy policy to state
            // exactly how the app accesses, uses, stores and shares Google user
            // data. Keep these four verbs explicit — a reviewer looks for them.
            heading: "Signing in with Google",
            body: [
                "Signing in with Google is optional. You can always use a one-time code sent to your mobile or email instead, and you will get exactly the same account either way.",
                "What we access: when you choose Google, Google tells us your name, your email address and your profile picture. That is all we ask for. We do not request, and cannot see, your Google password, contacts, Gmail, Drive, Calendar, photos or any other Google service.",
                "How we use it: only to identify you, create or find your customer account, and sign you in. Your email address is also used to send you order and repair updates. We do not use Google data for advertising or profiling, and we do not sell it.",
                "How we store it: your name and email address are stored in our own customer records for as long as you have an account, exactly like the details of a customer who signed up with a one-time code. We do not keep a copy of your Google password because we never receive one.",
                "Who we share it with: nobody, beyond the service providers listed above who need it to run the site. We do not pass Google data to advertisers or data brokers.",
                "You can disconnect our app at any time from your Google Account permissions page. Your account and order history with us stay intact — sign in with a one-time code instead. To delete the account itself, see 'Your rights' below.",
            ],
        },
        {
            heading: "Cookies and local storage",
            body: [
                "We use cookies and browser local storage to keep you signed in, remember your cart, wishlist and comparison list, and remember your light or dark theme choice. These are needed for the site to work.",
                "You can block or clear cookies in your browser settings, but the cart and sign-in will then not work correctly.",
            ],
        },
        {
            heading: "How long we keep your data",
            body: [
                "We keep order, invoice and GST records for as long as Indian tax law requires — currently eight financial years.",
                "We keep repair and warranty records for as long as the warranty runs, plus a reasonable period after, so we can honour repeat claims.",
                "We keep account data until you ask us to close your account. One-time codes are deleted shortly after they expire.",
            ],
        },
        {
            heading: "Your rights",
            body: [
                "Under the Digital Personal Data Protection Act, 2023, you may ask us to:",
                "- Tell you what personal data of yours we hold and who we have shared it with.",
                "- Correct anything that is wrong, incomplete or out of date.",
                "- Erase data we no longer need for a lawful purpose.",
                "- Nominate someone to exercise these rights on your behalf if you die or become incapable.",
                `To make a request, write to ${C.contact.supportEmail}. We will respond within a reasonable time. If you are not satisfied with our answer, you may complain to the Data Protection Board of India.`,
            ],
        },
        {
            heading: "Security",
            body: [
                "We protect your data with encrypted connections, access control, and staff accounts that only see what their role needs. Payment card data never reaches our servers.",
                "No system is perfectly secure. If a breach affects your personal data, we will inform you and the Data Protection Board as the law requires.",
            ],
        },
        {
            heading: "Children",
            body: [
                "Our store and portal are meant for people aged 18 and above. We do not knowingly collect data from children. If you believe a child has given us personal data, write to us and we will delete it.",
            ],
        },
        {
            heading: "Changes to this policy",
            body: [
                "We may update this policy from time to time. The date at the top of this page shows when it last changed. Please check it now and then.",
            ],
        },
        {
            heading: "Grievance contact",
            body: [
                `If you have a complaint about how we handle your personal data, write to our grievance contact at ${C.contact.supportEmail}, or post to ${C.legalName}, ${POSTAL_ADDRESS}. We aim to acknowledge every complaint within 48 hours and resolve it within 30 days.`,
            ],
        },
    ],
};

export const TERMS_OF_SERVICE: LegalDoc = {
    slug: "terms",
    title: "Terms of Service",
    summary: `The terms on which ${C.legalName} sells products and provides repair and service work.`,
    lastUpdated: LAST_UPDATED,
    sections: [
        {
            heading: "Agreement",
            body: [
                `These terms are between you and ${C.legalName}, ${POSTAL_ADDRESS}, GSTIN ${C.tax.gstin}. By using this website, placing an order, or booking a repair, you accept these terms.`,
                BOTH_SITES,
                "If you do not accept them, please do not use the site.",
            ],
        },
        {
            heading: "Your account",
            body: [
                "You must give correct details when you create an account, and keep your mobile number and email up to date so we can reach you.",
                "You are responsible for what happens under your account. Do not share your one-time codes with anyone. Our staff will never ask you for your OTP — if someone does, it is a fraud attempt.",
                "We may suspend or close an account that is used for fraud, abuse, or anything unlawful.",
            ],
        },
        {
            heading: "Products, prices and availability",
            body: [
                `All prices are in Indian Rupees (${C.currencySymbol}) and include GST unless we state otherwise. The GST split is shown on your invoice.`,
                "We try hard to describe products and show images accurately, but small differences in colour, packaging or revision can occur. Specifications come from the manufacturer and may change without notice.",
                "Stock is not guaranteed until we accept your order. If an item turns out to be unavailable after you have paid, we will tell you and refund that item in full.",
                "If a product is listed at a clearly wrong price because of a technical or human error, we may cancel the order and refund you in full. We will contact you before doing so.",
            ],
        },
        {
            heading: "Orders and acceptance",
            body: [
                "Your order is an offer to buy. A contract is formed only when we confirm the order and dispatch it — not when you place it or pay.",
                "We may decline an order where stock has run out, where we cannot verify your details, where delivery to your area is not possible, or where we suspect fraud.",
            ],
        },
        {
            heading: "Payment",
            body: [
                "You can pay online through Razorpay, or at our counter by the methods we accept there. Online payments are handled entirely by Razorpay under their own terms — we never see your card number or UPI PIN.",
                "For a business purchase, give us your GSTIN before we raise the invoice. We cannot change the GSTIN on an invoice after it is issued.",
            ],
        },
        {
            heading: "Delivery",
            body: [
                "Delivery timelines and charges are set out in our Shipping Policy, which forms part of these terms.",
                "Risk in the goods passes to you on delivery. Please check the packaging before you accept it, and refuse a parcel that is visibly damaged or already opened.",
            ],
        },
        {
            heading: "Returns and refunds",
            body: [
                "Your rights to cancel, return and be refunded are set out in our Refund & Cancellation Policy, which forms part of these terms.",
            ],
        },
        {
            heading: "Warranty",
            body: [
                C.policies.warrantyNote,
                "Warranty is provided by the manufacturer under their own terms. We help you raise and follow up a claim, but the manufacturer decides the outcome.",
                "Warranty does not cover physical damage, liquid damage, damage from incorrect voltage, unauthorised repair, tampered serial numbers, or normal wear such as battery ageing.",
            ],
        },
        {
            heading: "Repair and service work",
            body: [
                "When you hand over a device for repair, we give you a job reference. Please quote it when you ask about status, and bring it when you collect.",
                "Please back up your data before handing over any device. Repair can involve formatting or replacing storage. We are not responsible for data loss.",
                "Remove SIM cards, memory cards and accessories before handing over. We are not responsible for items left inside.",
                "We will tell you the estimated cost before starting chargeable work. If the actual cost will be higher, we will ask you again before continuing.",
                "Please collect your device within 90 days of us telling you it is ready. After that we may charge reasonable storage, and after 180 days we may dispose of an uncollected device to recover our dues, after giving you written notice.",
            ],
        },
        {
            heading: "Acceptable use",
            body: [
                "Do not use this site to break the law, to interfere with its working, to scrape it in bulk, to attempt unauthorised access, or to upload anything harmful or infringing.",
            ],
        },
        {
            heading: "Our content",
            body: [
                `The text, layout, logos and design of this site belong to ${C.legalName}. Product images and brand names belong to their respective owners. Do not copy or reuse them without permission.`,
            ],
        },
        {
            heading: "Limitation of liability",
            body: [
                "Nothing in these terms limits any liability that cannot be limited under Indian law, including liability for death or personal injury caused by our negligence, or for fraud.",
                "Subject to that, our total liability for any claim connected with an order is limited to the amount you paid for that order.",
                "We are not liable for indirect or consequential loss — for example loss of profit, loss of business, or loss of data.",
            ],
        },
        {
            heading: "Events outside our control",
            body: [
                "We are not liable for delay or failure caused by events outside our reasonable control, such as natural disaster, strike, riot, transport failure, power or network failure, or government action. We will tell you if such an event affects your order.",
            ],
        },
        {
            heading: "Governing law and jurisdiction",
            body: [
                `These terms are governed by the laws of India. The courts at ${C.address.city}, ${C.address.state} have exclusive jurisdiction over any dispute.`,
            ],
        },
        {
            heading: "Changes to these terms",
            body: [
                "We may change these terms from time to time. The version in force is the one published here when you place your order. The date at the top shows when it last changed.",
            ],
        },
        {
            heading: "Contact us",
            body: [
                `${C.legalName}, ${POSTAL_ADDRESS}. Email ${C.contact.supportEmail}. Phone ${C.contact.phone}. WhatsApp ${C.contact.whatsapp}. Open ${C.hours}.`,
            ],
        },
    ],
};

export const REFUND_POLICY: LegalDoc = {
    slug: "refunds",
    title: "Refund & Cancellation Policy",
    summary: `How to cancel an order, return a product, and how long a refund takes at ${C.legalName}.`,
    lastUpdated: LAST_UPDATED,
    sections: [
        {
            heading: "Who this covers",
            body: [BOTH_SITES],
        },
        {
            heading: "Cancelling an order",
            body: [
                "You can cancel any order free of charge before it is dispatched. Ask us through the portal, by email, or on WhatsApp, and we will refund you in full.",
                "Once an order has been dispatched it cannot be cancelled. Please refuse the delivery or return it instead, as described below.",
            ],
        },
        {
            heading: `Returns — ${RETURN_DAYS} days`,
            body: [
                `You may return most products within ${RETURN_DAYS} days of delivery. The product must be unused, in its original box with all accessories, manuals, cables and free gifts, and with the seal and serial-number sticker intact.`,
                "Tell us within that window and we will arrange a pickup, or you can drop the item at our counter.",
            ],
        },
        {
            heading: "What we cannot take back",
            body: [
                "- Software, licence keys and any product whose seal or activation has been used.",
                "- Consumables that have been opened, such as ink and toner cartridges.",
                "- Products damaged by misuse, physical impact, liquid, or incorrect voltage.",
                "- Products with a missing, altered or removed serial number.",
                "- Products made or ordered specially to your specification, including assembled custom PCs.",
                "Once the return window has passed, a faulty product is handled as a warranty claim rather than a return.",
            ],
        },
        {
            heading: "Damaged, wrong or faulty on arrival",
            body: [
                "If a parcel arrives visibly damaged, please refuse it and tell us the same day.",
                "If you find the item damaged, wrong or not working after opening, tell us within 48 hours of delivery with photographs. We will replace it or refund you in full, including delivery charges, and we will pay the return shipping.",
            ],
        },
        {
            heading: "Refund method and timing",
            body: [
                "We inspect a returned product within 2 working days of receiving it. Once approved, we start the refund the same day.",
                "Refunds go back to the same method you paid with. A Razorpay refund normally reaches your account within 5 to 7 working days, depending on your bank. Counter payments are refunded in cash or to your bank account.",
                "We will tell you when the refund has been started, and give you the reference so you can track it with your bank.",
            ],
        },
        {
            heading: "Deductions",
            body: [
                "A full refund includes what you paid for the product. Delivery charges are refunded only where the return is our fault — a damaged, wrong or faulty item.",
                "Where a product comes back with missing accessories or damaged packaging, we may deduct a reasonable amount and will tell you the figure before we refund.",
            ],
        },
        {
            heading: "Repair and service charges",
            body: [
                "Diagnostic and labour charges for work already carried out are not refundable.",
                "Where we have quoted for a repair and you decide not to go ahead, only the diagnostic charge applies.",
            ],
        },
        {
            heading: "Need help?",
            body: [
                `Email ${C.contact.supportEmail}, call ${C.contact.phone}, or message us on WhatsApp at ${C.contact.whatsapp} during ${C.hours}. Please quote your order or job number.`,
            ],
        },
    ],
};

export const SHIPPING_POLICY: LegalDoc = {
    slug: "shipping",
    title: "Shipping Policy",
    summary: `Delivery charges, timelines and coverage for orders from ${C.legalName}.`,
    lastUpdated: LAST_UPDATED,
    sections: [
        {
            heading: "Who this covers",
            body: [BOTH_SITES],
        },
        {
            heading: "Where we deliver",
            body: [
                "We deliver across India through our courier partners. Some pin codes are not serviceable — the checkout will tell you if yours is not covered.",
                "For addresses near our store, our own delivery staff may bring the order instead of a courier.",
            ],
        },
        {
            heading: "Delivery charges",
            body: [
                `Delivery is free on orders of ${FREE_SHIPPING_FROM} and above.`,
                "Below that, the charge depends on the weight of your order and where it is going. The exact amount is shown at checkout before you pay — there are no charges added afterwards.",
                "You can also choose to collect from our store at no charge.",
            ],
        },
        {
            heading: "Dispatch and delivery time",
            body: [
                "We dispatch in-stock orders within 1 to 2 working days of payment being confirmed.",
                "Metro cities usually receive delivery in 2 to 4 working days after dispatch. Other cities and towns usually take 4 to 7 working days. Remote areas in the North-East, hill districts and islands can take longer.",
                "These are estimates, not guarantees. Weather, strikes, festival rush and courier delays can add time.",
            ],
        },
        {
            heading: "Store pickup",
            body: [
                `You can select store pickup at checkout and collect from ${POSTAL_ADDRESS} during ${C.hours}. We will message you when your order is ready. Please bring your order number and a photo ID.`,
            ],
        },
        {
            heading: "Tracking your order",
            body: [
                "Once dispatched, we send you the courier name and tracking number by SMS and email. You can also see the status any time in your customer portal under My Orders.",
            ],
        },
        {
            heading: "Receiving your order",
            body: [
                "Please check the parcel before you accept it. If the packaging is torn, wet, or already opened, refuse the delivery and tell us the same day.",
                "Someone aged 18 or above must be present to receive the delivery. Couriers normally attempt delivery up to three times before returning the parcel to us.",
            ],
        },
        {
            heading: "Undelivered and returned parcels",
            body: [
                "If a parcel comes back to us because the address was wrong, nobody was available, or delivery was refused without reason, we will contact you to arrange a re-send. Re-delivery charges may apply.",
                "If we cannot reach you within 7 days, we will cancel the order and refund it, less the delivery cost already incurred.",
            ],
        },
        {
            heading: "Questions about a delivery",
            body: [
                `Email ${C.contact.supportEmail}, call ${C.contact.phone}, or message ${C.contact.whatsapp} during ${C.hours}. Please have your order number ready.`,
            ],
        },
    ],
};

/**
 * Every slug must have a document — TypeScript fails the build if a slug is
 * added to LEGAL_SLUGS without the prose to go with it.
 */
const DOC_BY_SLUG: Record<LegalSlug, LegalDoc> = {
    terms: TERMS_OF_SERVICE,
    privacy: PRIVACY_POLICY,
    refunds: REFUND_POLICY,
    shipping: SHIPPING_POLICY,
};

/** All documents, in the order they appear in the footer. */
export const LEGAL_DOCS: LegalDoc[] = LEGAL_SLUGS.map((slug) => DOC_BY_SLUG[slug]);

/** Footer / nav links — single source for every surface that lists the policies. */
export const LEGAL_LINKS = LEGAL_DOCS.map((doc) => ({
    href: `/${doc.slug}`,
    label: doc.title,
}));
