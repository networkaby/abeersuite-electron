# v1.17.11

An update for the office, database operations, and online shop product preparation.

## Online Shop & AI Product Preparation

- **In-browser photo editor (Filerobot)**: full photo editing (crop, rotate, filters, annotations) right from the product edit page beside Adjust.
- **Clean up cut-out**: one-click background removal to solid white directly in the browser using the prep agent's cut-out service.
- **Adjust picture integration**: edit, frame, and adjust photos together with instant zoomable preview.
- **Missing must-photo protection**: if a required photo is missing, the product image validation alerts staff and safely keeps the product off the shop until fixed.
- **Saving a product no longer fails when the database is slow**: the product save now finishes its changes first and loads the full product afterwards, so AI prep runs stop failing with "transaction expired".
- **One open-problem list**: every product problem, whether the AI or staff raised it, sits in one shared list. Staff can leave tasks for the AI in the notes box using `{}` items.
- **Problem history**: when a problem is closed it is kept with who raised it, who closed it and when. Each part shows one run line above the open problems.
- **"Start" stage and current stage on the edit page**: "Waiting" is now called "Start", and the product edit page shows the stage beside the name.
- **"Can't fix now" is a temporary pass**: the problem stays listed until it is really fixed. The checklist tick "Can't add" is now "Not applicable".
- **Photos filter**: filter products by photo count: up to 2, 3, 4 or 5, or 6 and more.
- **Photo-only prep (Part 5)**: products that already have a description get only their photos treated, with no web search: cut-outs to white, a blanked covered MRP, and the original photo kept.
- **Problem search**: the products list shows the problem first under Shop status.

## Database & Standby Operations

- **Copy into standby now**: a button in Office Settings starts the standby copy at once, without waiting for the night.
- **Reliable read-only locking**: Lock and Unlock now end old database sessions, so the standby copy no longer fails.
- **Accurate lock check**: the lock check no longer refuses because of a background timestamp.
