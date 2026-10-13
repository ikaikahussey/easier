# easier.company

Firm-grade professional services at plain prices. AI prepares the work, a licensed professional reviews and signs it, and the client pays a published flat fee.

The first products are **Form 990 preparation** (Easier Tax) and **monthly nonprofit close** (Easier Books, formerly Augmented Accountants).

## Business model

- **Flat, published prices**, set at roughly one-third to one-half of what a traditional firm charges (`PRICING` in each product module).
- **Human sign-off on every deliverable.** Each product declares which credentials may approve it (`reviewerCredentials`). Approval is blocked while any must-fix finding remains.
- **The Labor Pledge.** For every engagement, the platform estimates how many hours a human professional would have spent on the work, task by task, from the actual workload (accounts classified, expense lines allocated, programs written up, officers listed, schedules prepared). easier.company values those hours at a living wage and voluntarily contributes 12.4%, the combined Social Security (OASDI) payroll tax rate, to worker retirement: `contribution = hours × living wage × 12.4%`. The living wage is $23.08/hour, the unweighted average of the 50 states and D.C. for one working adult in the MIT Living Wage Calculator (2025); override with `LIVING_WAGE_HOURLY_CENTS`. The contribution comes out of easier.company's fee, not on top of it. Every quote shows the hours, the task breakdown, and the amount. See `src/core/pledge.ts` and each product's `labor` function.
  - Benchmarks (`BENCHMARK`, `BOOKS_MONTHLY_BENCHMARK`) are placeholder estimates. Replace them with a documented market survey before publishing.
  - Set `PLEDGE_RECIPIENT` to the fund that receives contributions.

## Architecture

```
src/core/            product-agnostic platform
  product.ts         ProductDefinition contract every product implements
  fields.ts          declarative intake: one spec → validation, form UI, form-data parsing
  workflow.ts        shared lifecycle: awaiting_documents → in_review → approved → delivered
  rules.ts           findings engine (error blocks approval; warning/info inform the reviewer)
  draft.ts           build → check → render pipeline
  ai/                AiTask (prompt + schema + deterministic fallback), AiRunner (caching), Anthropic adapter
  ledger/            CSV + trial balance import, line catalogs, classification pipeline, shared ledger rules
  render.ts          worksheet section builders; one generic UI renders every product
  pledge.ts          Labor Pledge terms
  crypto.ts          per-tenant envelope encryption, signed sessions
  db/                Drizzle schema + client, tenant/system transaction scopes
  services/          organizations, engagements, auth (the only path from UI to data)
src/domains/nonprofit  990-keyed line catalog shared by Books and Form 990
src/products/        form-990, books, and the registry (index.ts)
  form-990/parts/      core-form parts: heading, IV (checklist), V, VI, VII, XI–XII
  form-990/schedules/  one module per IRS schedule (A, B, C, D, E, F, G, I, J, L, M, N, R): intake, computation, rules, worksheet
  form-990/export.ts   the approved return as line-numbered JSON (with Form 8879-TE values)
src/app, src/ui      Next.js pages and generic components
drizzle/             SQL migrations, including 0001_tenant_isolation.sql (RLS)
```

**Adding a product** means writing a module that satisfies `ProductDefinition` (intake spec, documents, `build`, `rules`, `render`, `quote`, optional `deadline`) and listing it in `src/products/index.ts`. Intake forms, the review workspace, workflow, audit trail, encryption, and pricing display come from the platform.

**Form 990 core form.** Every line of Form 990 (heading items A–M, Parts I–XII) and Form 990-EZ (Parts I–VI) is either computed from the classified ledger or collected in the intake. Part IV (the checklist) is answered from the books, the schedule triggers, and a short set of direct questions; any schedule or part it requires that this service does not prepare (Schedule D Parts I–V, H, K, R Part VI) is a blocking finding. Part VII lists every officer, director, trustee, key employee, and highest compensated employee with position, hours, and the three compensation columns, plus the five highest contractors over $100,000; Schedule J is triggered from its lines 3–5. Part XI reconciles net assets to the balance sheet and blocks approval on an unexplained difference. Form selection applies the $75,000 first-year and $60,000 early-years tests from the year of formation.

**Form 990 schedules.** The Part IV checklist (`form-990/schedules.ts`) decides which schedules apply. Each schedule module (`form-990/schedules/`) declares the client questions it needs, computes its figures from the ledger and those answers, checks them, and renders worksheet sections. Highlights:

- Schedule A computes the five-year public support tests (Part II for 170(b)(1)(A)(vi), Part III for 509(a)(2)), including the 2% donor limit, the $5,000/1% payer limit, disqualified persons, the first-five-years rule, and the 10% facts-and-circumstances test.
- Schedule B applies the general rule or, for organizations that pass the 33⅓% test, the special rule (greater of $5,000 or 2% of line 1h).
- Schedule C computes the 501(h) nontaxable amounts and the four-year averaging ceilings.
- Schedule D Part VI is built from the fixed asset accounts and must tie to Part X line 10c; Parts VII–X list the accounts behind Part X lines 12, 13, 15, and 25; Parts XI–XII reconcile audited statements to Part I lines 12 and 18.
- Schedule G splits event receipts: the contribution portion moves from Part VIII line 8a to line 1c before anything else reads revenue.
- Schedules E, F, I, J, L, M, N, and R list and check the detail and tie it to the books where possible.

Schedule questions are optional in the intake form (folded by default) and become blocking findings when the schedule applies. Clients can revise their answers until the engagement goes to review. Not prepared: Schedule D Parts I–V (donor advised funds, easements, collections, escrow, endowments), Schedules H and K, Schedule A Part IV (supporting organizations), Schedule R Part VI, Forms 990-T and 4720.

**Export.** The approved return downloads from the package page as line-numbered JSON in whole dollars (`/engagements/{id}/package/return.json`): heading, Parts I–XII, every schedule's detail, Schedule O, the Form 990-EZ line mapping for EZ filers, and the Form 8879-TE Part I values. It is the hand-off to filing software until a transmitter integration exists.

**Classification pipeline:** reviewer override → keyword rule → AI (validated against the account type) → catch-all line flagged for review. AI outputs are cached per draft by input hash, so reviewer edits do not trigger new model calls unless an AI input changed. Without `ANTHROPIC_API_KEY`, deterministic fallbacks run and unmatched accounts are routed to the reviewer.

## Client data protection

Isolation is enforced in independent layers:

1. **Postgres row-level security.** Client-data queries run as the non-owner `easier_app` role, with the user set per transaction. Tenancy derives from the `memberships` table, never from a request parameter. A query with no `WHERE` clause still returns only the caller's rows. Staff identity is honored only if the `users` table confirms the role.
2. **Composite foreign keys** force every document, draft, and event to carry the same `org_id` as its engagement.
3. **Per-client encryption.** Each organization has its own AES-256 data key, wrapped by `DATA_ENCRYPTION_KEY`. Intake, uploaded files, parsed data, drafts, overrides, and audit payloads are sealed with AES-256-GCM and bound to org and record IDs. Ciphertext moved to another tenant or record will not decrypt. Destroying an org's key (`destroyOrganizationKey`) makes its data unrecoverable.
4. **Assignment-gated staff access.** Reviewers see queue metadata. They can read content, and the org key, only for engagements assigned to them. Every staff view is written to the client-visible audit trail.
5. **Application controls.** Passwordless sign-in uses single-use, hashed, 15-minute tokens consumed by POST (link scanners cannot burn them), with rate limiting. Sessions are HMAC-signed, httpOnly cookies. Responses carry a strict CSP, `frame-ancestors 'none'`, HSTS, and `no-store` on client pages. Uploads are capped at 5 MB.
6. **AI boundary.** A model call receives only the current engagement's data. Cached AI outputs live inside that engagement's encrypted draft.

## Pre-launch access

Until launch, the public sees only a teaser at `/` with a waitlist form. Everything else requires sign-in, and sign-in is invitation-only: staff (`ADMIN_EMAILS`, `REVIEWER_EMAILS`), emails in `ACCESS_EMAILS` (comma-separated), and existing users. Anyone else who requests a sign-in link is added to the waitlist and gets the same on-screen message, so the form does not reveal who has access. Waitlist rows live in the `waitlist` table, readable only by server code. Set `SITE_ACCESS=open` at launch to let anyone sign in.

## Themes

All UI colors come from `src/ui/theme.ts`. Set `SITE_THEME` to `poster` (default: blue, red, gold), `teal`, or `arcade`. To add a theme, add an entry to `THEMES` with the same 15 tokens; `tests/theme.test.ts` fails the build if it misses WCAG contrast minimums.

## Running locally

```bash
npm install
npm run dev        # embedded Postgres in ./.pglite; sign-in links print to the server log
```

Set `REVIEWER_EMAILS=you@example.com` to sign in as a reviewer.

## Tests

```bash
npm run check      # typecheck → unit/integration tests → production build → end-to-end
```

- `tests/core.test.ts`, `tests/products.test.ts`: parsing, classification, deadlines, rules, form selection, schedules, allocation, pledge.
- `tests/schedules.test.ts`: each schedule's computation against figures worked by hand from the fixtures.
- `tests/core-form.test.ts`: form selection by age, Part IV answers, Part VII, Part XI reconciliation, Parts V–VI, Schedules E, N, C averaging, R Part V, D Parts VII–X, and the export.
- `tests/services.test.ts`: full lifecycle plus tenant isolation against real Postgres (PGlite) with RLS.
- `scripts/e2e.mjs`: drives the production build through plain HTML forms (no JavaScript) for sign-in, intake, upload, AI draft, reviewer claim, reclassify, and approve, plus cross-tenant 404s.

## Deploying (Vercel + Neon)

Set the variables in `.env.example`. `DATABASE_URL`, `DATA_ENCRYPTION_KEY` (`openssl rand -base64 32`), `SESSION_SECRET`, and `RESEND_API_KEY` are required in production. The `vercel-build` script runs migrations before `next build`. The migration role must be able to `CREATE ROLE` (Neon's default owner can).

## Not yet built

- IRS e-file transmission (MeF) and Form 8879-TE e-signature. Approved work produces a review package today. No vendor yet offers a verified API for full 990/990-EZ data; see the e-file options note in the project.
- Payments, multistate charity registration, document (PDF) intake, and reviewer credential verification.
