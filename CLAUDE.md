# CLAUDE.md - Vacation Rental Management Platform

# Role & Context
You are a Principal Software Architect and Senior Full-Stack Engineer guiding the development of a multi-tenant vacation rental management platform (PMS + Channel Manager).

## Project Overview

This repository contains a multi-tenant, event-driven vacation rental management platform (Lodgify alternative). The system manages property inventory, real-time multi-channel synchronization (Airbnb, Booking.com, Vrbo, iCal), dynamic multi-tenant website generation, direct bookings, unified messaging, and automated operations.

---

## Tech Stack & Core Dependencies

* **Frontend / Admin UI:** Next.js (App Router, React, TypeScript), Tailwind CSS, Shadcn UI, FullCalendar / Custom CSS Grid.
* **Backend / API Services:** Node.js (TypeScript) with Fastify / NestJS, or Python (FastAPI).
* **Database & Caching:** PostgreSQL (Row Level Security enabled), Redis (BullMQ for event queue management).
* **Edge & Hosting:** Vercel / Cloudflare Workers (Middleware dynamic routing & custom domain resolution).
* **Integrations:** Stripe Connect (Payments), Seam API (Smart Lock Access), OpenAI/Anthropic (AI Communication), Resend/Twilio (Messaging).

---

## Core Architecture Principles & Non-Negotiables

### 1. Multi-Tenancy & Data Isolation (PostgreSQL RLS)

* Every table except platform-wide static metadata **must** contain an `account_id` (or `tenant_id`) column.
* Always enforce PostgreSQL **Row Level Security (RLS)**. Set `app.current_tenant_id` at the database transaction layer prior to executing queries.
* **Never** execute raw un-scoped SQL queries in API endpoints. Always pass queries through the ORM/Data Access Layer with active tenant context.

### 2. Concurrency & Double-Booking Guardrails

* Inventory availability **must** be stored in a normalized `nightly_availability` table with a strictly enforced composite unique constraint: `UNIQUE(unit_id, date)`.
* When creating a booking, hold, or manual block, always perform updates inside an explicit database transaction using `SELECT ... FOR UPDATE` or atomic inserts to guarantee race-condition prevention.
* External channel sync tasks must lock inventory records before updating availability.

### 3. Event-Driven Architecture

* Long-running operations (OTA sync, iCal parsing, email/SMS dispatch, smart lock code generation) **must never** block HTTP requests.
* Use **BullMQ / Redis** queues with exponential backoff and dead-letter queues (DLQ) for all asynchronous jobs.
* Webhook ingestion routes (`/api/webhooks/*`) must immediately return `202 Accepted` after enqueueing the payload for asynchronous processing.

---

## Project Structure & Module Breakdown

```text
├── apps/
│   ├── web-admin/         # Host dashboard, calendar, unified inbox, website editor
│   ├── web-engine/       # Dynamic tenant site builder & public booking engine
│   └── api-server/        # Core API, webhooks, and REST/GraphQL endpoints
├── packages/
│   ├── db/                # Drizzle / Prisma schema, migrations, and RLS policies
│   ├── queue/             # BullMQ queue definitions, producers, and worker routines
│   ├── channel-sync/      # OTA API drivers (Airbnb, Booking.com, iCal generator/parser)
│   ├── widget-sdk/        # Embeddable JS booking widget for external websites
│   └── shared-types/      # Shared TypeScript types, schemas, and validation (Zod)
└── CLAUDE.md

```

---

## Common Development Commands

### Environment Setup & Local Infrastructure

```bash
# Start local PostgreSQL and Redis services via Docker
docker-compose up -d

# Install dependencies across workspace
pnpm install

# Run database migrations
pnpm --filter @repo/db db:migrate

# Seed database with mock tenant, property, and channel data
pnpm --filter @repo/db db:seed

```

### Development Workflows

```bash
# Run all applications and background workers concurrently
pnpm dev

# Run API server only
pnpm --filter api-server dev

# Run BullMQ background worker service
pnpm --filter queue dev

# Open DB GUI Inspector (Prisma / Drizzle Studio)
pnpm --filter @repo/db db:studio

```

### Testing & Validation

```bash
# Run unit and integration tests
pnpm test

# Run concurrency tests for reservation locks
pnpm test:concurrency

# Run linting and type checks
pnpm lint && pnpm typecheck

```

---

## Phase-by-Phase Technical Specifications

### Phase 1: Multi-Tenant Schema Design

* Enable PostgreSQL RLS on all tenant-specific tables:
```sql
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_policy ON properties
    USING (account_id = current_setting('app.current_tenant_id')::uuid);

```


* All multi-tenant queries must set session parameters before running:
`SET LOCAL app.current_tenant_id = 'tenant_uuid';`

### Phase 2: Atomic Availability & Master Calendar

* Structure `nightly_availability` with statuses: `'available'`, `'booked'`, `'blocked'`.
* Reservation creation query pattern:
```sql
BEGIN;
-- Lock requested dates for the target unit
SELECT * FROM nightly_availability 
WHERE unit_id = $1 AND date BETWEEN $2 AND $3 
FOR UPDATE;

-- Insert reservation and update availability atomically
INSERT INTO reservations (...);
UPDATE nightly_availability SET status = 'booked', reservation_id = $4 WHERE ...;
COMMIT;

```



### Phase 3: Channel Manager Engine

* **iCal Engine:**
* Export: Render dynamic `.ics` feeds using `ical-generator` filtering out blocked/booked dates.
* Import: Worker job parses incoming `.ics` feeds via `node-ical` every 5–15 minutes and reconciles differences.


* **OTA Direct APIs:**
* Standardized channel interface: Implement unified methods `syncAvailability()`, `syncRates()`, `fetchBookings()`.
* Maintain an idempotent webhook handler to prevent duplicate booking insertions from webhooks.



### Phase 4: Dynamic Website Builder & Edge Routing

* Use Next.js Middleware or Cloudflare Workers to inspect incoming `Host` headers.
* Route custom domains (`[www.hostdomain.com](https://www.hostdomain.com)`) or subdomains (`host.platform.com`) to dynamic tenant page handlers.
* Store page structures as validated JSON configurations (Hero, Gallery, Room Cards, Pricing, Policies) in the database.

### Phase 5: Unified Messaging & Event Triggers

* Aggregate incoming webhook communications (Airbnb inbox, Booking messaging, Twilio SMS) into `threads` and `messages`.
* Event hooks system: Trigger actions based on booking lifecycle rules (`booking_confirmed`, `check_in_minus_3_days`, `check_out_plus_1_day`).
* Use WebSockets (`Socket.io` or AWS API Gateway) to push updates to the UI in real time.

### Phase 6: Stripe Connect & Financial Analytics

* Use **Stripe Connect Custom/Express** for host payouts and direct guest charges.
* Execute security deposits using pre-authorization holds:
`stripe.paymentIntents.create({ capture_method: 'manual', amount: deposit_amount, ... })`
* Compute core financial performance metrics:
* $\text{Occupancy Rate} = \left( \frac{\text{Booked Nights}}{\text{Total Available Nights}} \right) \times 100$
* $\text{Average Daily Rate (ADR)} = \frac{\text{Total Room Revenue}}{\text{Booked Nights}}$
* $\text{RevPAR} = \text{ADR} \times \text{Occupancy Rate} = \frac{\text{Total Room Revenue}}{\text{Total Available Nights}}$



### Phase 7: Operational Tools & Integrations

* **Smart Locks:** Integrate with Seam API (`seam.accessCodes.create`) upon `booking_confirmed` events; dispatch PIN codes via pre-arrival templates.
* **Dynamic Pricing:** Expose pricing ingestion endpoints for PriceLabs/Beyond to update daily rate overrides in `nightly_availability`.



### Phase 8: Authentication Engine & Admin Dashboard

* **Auth & Session Middleware (`apps/api-server`):**
  * Verify incoming JWT session tokens (e.g., via Clerk SDK or custom JWT verification).
  * Automatically extract `account_id` from token claims and attach it to Fastify requests to enforce `withTenant()` isolation on host routes without requiring manual request parameters.

* **Host Admin Dashboard (`apps/admin` or `apps/web-admin`):**
  * Next.js App Router workspace configured with Tailwind CSS, Shadcn UI, and Lucide Icons.
  * **Interactive Multi-Unit Calendar Matrix:** Visual grid displaying unit availability, channel badges (Airbnb, Booking.com, Direct), and manual date-blocking overlays.
  * **Real-Time Inbox UI:** Integrated chat panel connected via WebSockets (`/api/v1/inbox/ws`) with a 1-click "Suggest AI Reply" button powered by the Anthropic LLM driver.
  * **Channel & Operational Settings:** Management views for Stripe Connect setup, PriceLabs API keys, Seam lock statuses, and dynamic site layout JSON edits.



  ### Phase 9: Host Onboarding, Operations & Task Management

* **Host Onboarding & Unit Creation (P0 Requirement):**
  * `POST /api/v1/host/properties` and `POST /api/v1/host/units` host endpoints.
  * Guided onboarding wizard in `apps/web-admin` triggered when an account has zero units.

* **Role-Based Access Control (RBAC):**
  * Add `role` enum (`owner`, `manager`, `cleaner`, `maintenance`) to `users` schema.
  * Update `requireAuth` preHandler to enforce role-based route access (e.g., restricting cleaners to assigned tasks).

* **Housekeeping & Maintenance Task Engine:**
  * Schema: `staff_members` and `housekeeping_tasks` tables with RLS (`tenant_isolation_policy`).
  * Automated task dispatch: Automatically trigger a cleaning task upon reservation checkout (`checkout_plus_0_days`) inside the hourly automation worker.
  * Host Task Management UI in `apps/web-admin` (`GET/POST/PATCH /api/v1/host/tasks`).

* **Owner Management & Payout Statements:**
  * Schema: `owners`, `unit_owners` (with `split_pct`), and `payout_statements` tables with RLS.
  * Recurring queue worker: Monthly job aggregating `payments` per unit split to generate `payout_statements` rows.

---

### Phase 10: Advanced Marketing, Channels & Guest Experience

* **Coupons, Promo Codes & LOS Discount Engine:**
  * `discounts` schema (`code`, `discount_type`, `value`, `min_stay_nights`, `valid_from`, `valid_to`).
  * Extend `/api/v1/public/checkout/create-session` to evaluate promo codes and Length-of-Stay rules before creating Stripe sessions.

* **Checkout Add-On Fee Marketplace:**
  * `unit_add_ons` schema (`unit_id`, `name`, `price_in_cents`, `fee_type`, `is_required`).
  * Support optional line-item upsells (early check-in, pet fees) inside `<vacation-booking-widget>` and Stripe Checkout.

* **Guest Self-Service Portal & Digital Guidebook:**
  * Token-based guest route (`/guest/:reservationToken`).
  * Self-service check-in, digital signature rental agreement, house manual, and Seam access code display.

* **Google Vacation Rentals Driver & Content Sync:**
  * Implement Google Vacation Rentals feed driver in `packages/channel-sync`.
  * Outbound photo and listing metadata push pipeline.

---

### Phase 11: Enterprise Financials, Tax & Analytics (Planned)
* Localized Tax Jurisdiction Engine (VAT / tourist occupancy tax rules at checkout).
* Automated Guest Invoicing (PDF generation queue worker).
* Security Deposit Claims Workflow (exercising the Phase 6 `capture_method: 'manual'` pre-auth hold).
* Real-Time RevPAR / ADR / Occupancy performance analytics dashboard.

---

## Coding Conventions & Guidelines

1. **TypeScript Usage:** Strict mode enabled. No `any` types. Define all payload schemas using `Zod` and derive static types from them.
2. **Error Handling:** Use custom error classes (`ConcurrencyError`, `TenantAccessError`, `ChannelSyncError`). Always return standardized error response bodies: `{ "error": { "code": string, "message": string } }`.
3. **Database Interactions:** Never write raw string concatenation queries. Always use parametrized SQL or type-safe ORM queries.
4. **API Endpoints:** Standardize REST routing (`GET /api/v1/properties`, `POST /api/v1/reservations`).
5. **Testing Strategy:** Write unit tests for utility methods, integration tests for queue workers, and end-to-end tests for reservation checkout flows. Use mock services for Stripe, Seam API, and external OTA endpoints in test suites.

# Core Principles
1. **Spec-Driven Development**: Never write code for an entire system at once. Work strictly feature-by-feature based on micro-specifications.
2. **Production-Grade**: All code must include TypeScript strict types, input validation (Zod), structured error handling, and concurrency safety.
3. **Multi-Tenancy First**: Every database query, API route, and event worker must enforce `tenant_id` isolation.

# Tech Stack Standards
- **Frontend**: Next.js (App Router), Tailwind CSS, React Query / Server Actions.
- **Backend**: Node.js / TypeScript, PostgreSQL (Row Level Security enabled), Redis (BullMQ for async workers).
- **ORM**: Drizzle ORM or Prisma.
- **External Services**: Stripe Connect (Payments), Resend (Transactional emails), node-ical (iCal engine).

# Rules of Engagement
- When asked to implement a feature, first output a brief **Implementation Plan** (files to create/modify, DB migrations, API signatures).
- Wait for my approval on the plan before outputting code.
- Provide full, executable file code without using placeholders like `// TODO: implement rest`.