# CRM API Prompt

Use this prompt to generate or review CRM API endpoints in this project.

## Context
- Stack: Next.js App Router + Prisma.
- API style: Route handlers under `src/app/api/**/route.ts`.
- Auth: Respect existing session and permission checks.
- Currency format in responses/UI examples: `₹`.

## Prompt
You are implementing CRM API endpoints for this codebase.

Requirements:
1. Follow existing project conventions for route handlers, Prisma queries, and permission checks.
2. Keep responses consistent and predictable.
3. Validate request payloads and return clear errors.
4. Add pagination and basic filtering where list endpoints are used.
5. Return timestamps in ISO format.

Deliver:
- Endpoint definitions (method, path, request body/query, response).
- Complete server-side code for each route handler.
- Prisma query logic with safe error handling.
- Minimal test plan with success and failure scenarios.

Feature scope:
- Call Log list endpoint
  - `GET /api/call-logs`
  - Query params: `page`, `pageSize`, `search`, `status`, `direction`
  - Response:
    - `items`: array of call log records
    - `pagination`: `page`, `pageSize`, `total`
- Create call log
  - `POST /api/call-logs`
  - Body: `customerName`, `phone`, `direction`, `status`, `durationSec`, `followUpAmount`
- Update call status
  - `PATCH /api/call-logs/:id`
  - Body: partial update for `status`, `durationSec`, `followUpAmount`

Output constraints:
- Use TypeScript.
- Reuse existing utilities/components where possible.
- Keep code production-ready, not pseudo code.
