# Module Maintenance Docs

Read the module doc relevant to the work you're doing **before** grepping. Each file follows the same template, so an agent or human landing in any module knows exactly where to look.

## Template

```markdown
# <Module Name>

> One-paragraph summary of what this module does and who uses it.

## URLs
### UI pages
- `/office/<module>/...` → file path

### API routes
- `GET /api/<module>/...` → file path + brief purpose

## Permissions (gate keys)
- `<area>:<op>:<scope>` — what it controls

## Prisma models
- `<Model>` (file: `prisma/schema/<file>.prisma`) — short purpose, key relations

## Key components
- `<Component>` (file: `src/modules/<module>/...`) — what it renders / when used

## Library / helpers
- `<helper>` (file: `src/lib/...`) — short purpose

## Common workflows (wiring)
1. <e.g. "Creating an invoice from a ticket"> — clickable trail of files involved.

## Recent decisions / gotchas
- One-liners pointing to dated decisions in memory.

## Out of scope / deferred
- Things the module doesn't own.

_Last updated: <YYYY-MM-DD> — covers state after <change>._
```

## Conventions

- One short paragraph per section, not exhaustive — this is a map, not a manual. Omit empty sections.
- Cross-link, don't duplicate. Link to source files and to other module docs when concerns cross.
- Date the doc footer so readers know when it might be stale.

## Module list

- [accountancy.md](./accountancy.md) — Tally/finance suite (renamed 2026-05-07)
- [repair.md](./repair.md) — Tickets, devices, service centres, warranty
- [inventory.md](./inventory.md) — Products, GRN, POs, units, categories
- [sales.md](./sales.md) — Store, online (ecommerce), wholesale, coupons, shop orders
- [customers.md](./customers.md) — Customer / Company / Account (GL ledger), CRM leads
- [admin.md](./admin.md) — Roles, users, branches, departments, posts, pipelines, statuses
- [messaging.md](./messaging.md) — Internal chat, notifications, social wall
- [customer-portal.md](./customer-portal.md) — External `/shop` + customer self-service
