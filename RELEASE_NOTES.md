# v1.9.1

A printing update for every counter and the office app. Every save at the counter now gives you a choice between saving only and saving with a print. Receipt and Payment slips now print the same way from every screen. There is no database change and no rush: counters install it on their own at the next quiet moment.

## Billing (POS)
- **Save or Save + Print, everywhere on the counter.** Sale, Estimate, Order, Exp, Return and Shift Close each show two buttons side by side. **Enter** saves without printing and **Ctrl + Enter** saves and prints.
- **Editing a sale** now asks too: Update Sale, or Update & Print Sale. Before this, it saved straight away with no print.
- **Estimates and Orders print on the counter's thermal printer.** Before this, they opened an A4 page and the browser print box. An Order's advance receipt also prints on the thermal printer now.
- The printer icon on the Sales Register's Orders and Estimates tabs prints the thermal slip, not A4.
- **Return** can now print a slip (it never printed before). The message after a return no longer ends in "JE undefined".
- **Exp** no longer prints every time. Choose Record or Record + Print.
- **Shift Close** has Close and Close + Print buttons instead of the "Print after save" tick.

## Printing
- **Receipt / Payment print as one slip from every button:** the Receipt form, Day Book, POS Rcv / Exp and the thermal printer. All of them follow the Receipt / Payment template in Settings.
- **Party balance** on a Receipt now prints from the Receipt form's "Print after save" too. Before this, that print left the balance out. A draft receipt no longer shows the "Before" balance shifted by its own amount.
- Receipt / Payment slips show the **date only**. The time they printed before was always a wrong "05:30".
- The template's **Branch address** switch now works on every voucher print: Sale, Purchase, returns, orders, GRN, Challan, estimates, Contra, Credit / Debit Note, Bank Deposit, Cash Handover, Journal and Receipt / Payment. Before this, it worked only on the POS bill.
- In **Settings → Print templates**, every voucher preview shows a sample branch address. Shift Close now shows its Branch address switch. Receipt / Payment no longer shows the HSN table and MRP options, which did nothing for them.
- Old links to a payment slip still open, and land on the same one page.
