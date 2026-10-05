# Quickstart: Foundation Platform

These are the exact steps to validate this feature end-to-end. The root `README.md` MUST contain the same "Local setup" steps.

## Prerequisites
- Node.js 22 LTS, pnpm 9 (`corepack enable`), Docker Desktop

## Local setup (target: under 15 minutes, SC-004)
```bash
pnpm install
docker compose up -d db
cp apps/api/.env.example apps/api/.env      # dev defaults work as-is
pnpm --filter @opsgraph/shared build
pnpm --filter api prisma migrate dev
pnpm --filter api prisma db seed
pnpm dev                                     # api :3000, web :5173
```
Open http://localhost:5173 and sign in as `admin@opsgraph.local` / `OpsGraph-Dev-2026!`.

## Quality gate (same as CI)
```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build
```

## Manual validation script

1. **US1: Sign in.** Sign in as each seeded user. The header shows the name and role. Only the admin sees "Admin". The analyst navigating to `/admin/users` sees the "Not permitted" page.
2. **US1: Sign out.** Sign out, then open `/admin/users`. You are redirected to `/login?next=/admin/users`. After signing in you return to that page.
3. **US1: Wrong password.** Enter a wrong password 5 times for analyst@. The message is always "Invalid email or password". The 6th attempt with the correct password is also refused, because the account is locked for 15 minutes.
4. **US2: Create a user.** As admin, create `test@opsgraph.local` (Analyst) with a temporary password. Sign in as that user. You are forced to the change-password page. After changing it you reach Home.
5. **US2: Role change.** As admin, change test@ to Operations Manager. As test@ (still signed in in another browser), the next request reflects the new role.
6. **US2: Deactivate.** As admin, deactivate test@. test@'s next action redirects to login, and signing in is refused.
7. **US2: Last admin.** Try to demote or deactivate the only admin. You see the error "At least one active Administrator is required".
8. **US3: Audit trail.** As admin, open `/admin/audit`. The actions above appear newest-first. Filter by action `user.role_changed`: before is Analyst and after is Operations Manager. No password values appear anywhere.
9. **US3: Database enforcement.**
   ```bash
   docker compose exec db psql -U opsgraph -c "DELETE FROM audit_entries;"
   ```
   Fails with `audit_entries is append-only`.
10. **US4: Health.**
    ```bash
    curl -i localhost:3000/api/health/ready     # 200, database up
    docker compose stop db
    curl -i localhost:3000/api/health/ready     # 503, database down
    curl -i localhost:3000/api/health/live      # 200
    docker compose start db
    ```
11. **US5: CI gate.** Open a PR that breaks a test. CI fails. Revert the break and CI passes.
