# v1.16.17

A small fixes update for every counter. No database change — install it whenever the counter is free.

## Billing (POS)

- When the office raises a customer's credit limit, the open bill on the counter now picks it up straight away — no need to clear and re-select the customer.

## App updates

- While an update downloads, the counter now shows how many MB have come down.
- A download that keeps crawling for 3 minutes is stopped and tried again later, instead of hanging forever.

## Counter setup

- Counters now receive the Google Business settings and backup settings from the office, so those features work on the counter too.

## Customer app

- When a customer proves a mobile number or email with an OTP and that number already belongs to a profile made at the counter, the two profiles are joined into one — their old bills and points come along.
- If that number was saved on a company, it moves to the person and the person is linked to that company.

## Marketing

- When Google refuses the sign-in for campaigns, the screen now says so clearly instead of showing a confusing database error.
