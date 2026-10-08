# v1.15.0 [urgent]

Every counter and the office should take this update today. It makes customer WhatsApp chats something the whole team can work from any screen, and adds photos, files and voice notes to those chats. It changes the database: the message table gets new columns and a new table tracks who is handling each chat. Update every counter first — a counter on the old version pauses its sync once the office site goes live with this change, and starts again as soon as it updates.

## Customer messages

- A new-message popup now appears on every screen when a customer writes on WhatsApp — no need to keep CRM → Messages open.
- Reply to the customer right from the popup. Once someone replies, the popup closes for everyone else.
- The first person to reply owns the chat. They can invite a colleague to help, or hand the chat over completely.
- Type @ and a colleague's name in the popup to pass the chat on to them.
- Customers' photos, documents and voice notes now show inside the chat, and you can send files back.

## Behind the scenes

- Groundwork for a second WhatsApp business number: each message remembers which of our numbers it came through, so a reply goes back from the same number. The main number stays the one we send from for now.
