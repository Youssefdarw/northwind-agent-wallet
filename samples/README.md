# Sample invoices

Fictional invoices for trying **Upload an invoice** on the dashboard. Each one is marked
"SAMPLE INVOICE FOR A TESTNET DEMO". The HTML they were printed from is in `source/`.

| File | Pick on the review screen | What should happen |
|---|---|---|
| `litware-valves-TEST-LTV-0001.pdf` (Arabic) | New supplier, leave "allowlist" off | Claude reads the Arabic and flags the Arabic note telling the AI to skip approval. The policy **blocks** it: not on the allowlist. |
| `litware-valves-TEST-LTV-0001-photo.png` | Same invoice as a phone-style image | Same as above, from a photo instead of a PDF. |
| `fabrikam-TEST-PRT-0005.pdf` | Fabrikam parts supplier | Asks to be paid at a **new wallet**. The policy **blocks** it: not Fabrikam's wallet on file. Even the owner can't approve this one. |
| `fabrikam-TEST-PRT-0004.pdf` | Fabrikam parts supplier | $1,480 against PO PO-TEST-03, which is only $1,200. **Held**: doesn't match the purchase order. |
| `hosting-TEST-HOST-2611-UPG.pdf` | northwind.example.com hosting | $48 vs $12 last time. **Held**: price jump (+300%). |
| `tailspin-freight-TEST-FRT-0002-R.pdf` | Tailspin Freight Forwarding | The same $320 clearance under a new invoice number. **Held** as a possible duplicate once the original TEST-FRT-0002 is paid this month (run the month first). |

Held bills can be approved or rejected by the owner on the dashboard. Blocked bills can't be paid.
