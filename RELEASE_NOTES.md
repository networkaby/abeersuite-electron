# v1.17.13

Billing counter fix for UPI payments. Every counter should install it, so a UPI payment request reaches the customer again.

## Billing — UPI payment request

- The UPI payment request sent to the customer on WhatsApp now arrives as a plain pay link, the same way bill links do. Earlier the link could open a "not found" page and the QR photo was sometimes dropped.
- It sends straight from the UPI payment row at checkout.
- If the bills WhatsApp number refuses the message, the shop's other number tries it. There is no more WhatsApp Web fallback.
