# v1.16.21 [urgent]

An urgent update for store counters, CRM deals, and web checkout. Includes important fixes for POS customer editing, UPI payment link requests, deal synchronization, and unified address entry across screens. All counters should take this update promptly today.

## Counter & Billing (POS)

- **Edit customer details**: The Edit Customer dialog now shows all saved contact numbers and gives one-click access to open the customer's full address book.
- **UPI payment requests**: If a payment link falls back to WhatsApp Web, the dialog now explains why so cashiers know what happened.
- **POS help window**: The help screen opens cleanly in its own window without interfering with the active billing screen.
- **Role permissions**: The "Send UPI request" permission is now properly grouped and configurable under the POS Shift & Till section in the Role Matrix.

## Customers & CRM

- **Inline company and contact creation**: When linking contacts or companies, you can now add a new entry immediately if it does not already exist.
- **Deals workstation**: The deal detail view has been updated to a comfortable, full-width workstation matching the help ticket interface.
- **Silent deal sync**: Deal boards update silently in the background without refreshing or disturbing your current view.
- **Customer messages**: Closing the message panel now reliably clears alert indicators and updates in real time.

## Online Shop & Portal

- **Streamlined checkout**: Logging in during checkout now skips unnecessary welcome dialogs and returns you straight to complete your purchase.
- **Address form improvements**: Address fields (lines, city, state, pincode) now follow a consistent, easy-to-fill format across all checkout and portal pages.

## Banking

- **Bank reconciliation**: Statement summaries and footer totals now display with clean spacing below the final transaction row.
