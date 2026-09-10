# NexusOS Express API

Express + strict TypeScript REST API shared by the NexusOS web client and future Android/iOS apps.

## Setup

```bash
npm install
copy .env.example .env
npm run db:migrate
npm run dev
```

The API binds to `0.0.0.0` and is reachable on the local network. Configure the exact trusted web
origins in the comma-separated `FRONTEND_ORIGINS` variable; wildcard CORS is intentionally not used.

PostgreSQL is the authoritative store. Authentication is under `/api/auth` and supports
email/password, phone OTP, and Google access-token exchange. Registration does not require a phone;
responses expose `requires_phone` so later customer/business setup can require it contextually.

Development OTP codes are cryptographically random and returned only by the explicitly selected
development delivery adapter. Production needs a real SMS provider adapter before deployment.
Google requires `GOOGLE_CLIENT_ID`. Real `.env` files are ignored.

Set `ADMIN_EMAILS` to a comma-separated allowlist of trusted administrator email addresses. Admin
authority is calculated by the API; public registration cannot create an administrator. An admin
can list/search users, activate/deactivate accounts, and perform confirmed soft deletion. Deletion
immediately revokes access and anonymizes credentials/contact data while preserving relational audit
integrity.

Web Push requires one VAPID key pair configured as `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and a
contact `VAPID_SUBJECT`. Push subscriptions are stored per authenticated user; expired browser
subscriptions are removed automatically after provider rejection.

The messaging API provides privacy-safe opposite-role discovery, customer-to-business follows,
business invitations, customer accept/reject decisions, and participant-only messages. Run
`npm run db:migrate` after pulling schema changes.

## Checks

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
```

## Broadcast inbox migration

Run `npm run db:migrate`. Broadcast publication atomically creates messages in eligible accepted
customer conversations. Message `client_id` UUIDs make retries idempotent. A one-time migration
backfills existing broadcasts using currently eligible list membership; later list edits do not
grant access to already published broadcasts.

To verify against PostgreSQL without adding fixtures to application tables, run
`npx tsx scripts/check-inbox-postgres.ts`. It creates and removes an isolated test schema.
