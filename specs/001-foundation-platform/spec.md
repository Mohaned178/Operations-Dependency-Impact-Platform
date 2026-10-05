# Feature Specification: Foundation Platform

**Feature Branch**: `001-foundation-platform`
**Created**: 2026-10-05
**Status**: Draft
**Input**: User description: "Foundation: pnpm monorepo (apps/api NestJS+Prisma, apps/web React+Vite, packages/shared zod), Docker Postgres, JWT auth with roles (Admin, Ops Manager, Analyst), append-only audit log module, health endpoint, GitHub Actions CI (lint, typecheck, test with Postgres service)."

## Overview

This feature delivers the base every later OpsGraph capability is built on. It includes:

- a runnable application with a web interface and a backend service
- secure sign-in with role-based access
- a tamper-resistant audit trail
- a health check
- an automated quality gate that blocks broken changes

It delivers no operational-graph functionality. Its value is that every later feature inherits identity, permissions, auditability (Constitution Principle IV) and test gating (Principle V) without reinventing them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sign in and reach the role-appropriate workspace (Priority: P1)

An OpsGraph user (Administrator, Operations Manager, or Operations Analyst) opens the web application, signs in with their email and password, and lands in the application shell. The shell shows their name and role, and its navigation exposes only the areas their role may access. They can sign out at any time.

**Why this priority**: No other feature can be used or protected without authenticated, role-aware access.

**Independent Test**: Seed one user per role. Sign in as each, confirm the shell displays the correct role and navigation, then sign out and confirm protected pages are no longer reachable.

**Acceptance Scenarios**:

1. **Given** an active user with valid credentials, **When** they submit the sign-in form, **Then** they are taken to the home area of the shell, which shows their name and role.
2. **Given** a user who enters a wrong password, **When** they submit the form, **Then** they see a generic "invalid email or password" message that does not reveal whether the email exists.
3. **Given** a signed-in user, **When** they sign out, **Then** their session ends, and revisiting any protected page sends them to sign-in.
4. **Given** a visitor who is not signed in, **When** they open a protected page directly, **Then** they are sent to sign-in and returned to that page after signing in successfully.
5. **Given** a signed-in user whose session has expired, **When** they perform an action, **Then** the session is renewed transparently if renewal is still allowed. Otherwise they are asked to sign in again, without losing the page they were on.

---

### User Story 2 - Administrator manages users and roles (Priority: P1)

An Administrator creates user accounts and assigns each one exactly one role (Administrator, Operations Manager, Operations Analyst). They can change a user's role, deactivate and reactivate accounts, and set a temporary password. Non-administrators cannot access any of this.

**Why this priority**: The product has no self-registration, so it cannot onboard a second person without this.

**Independent Test**: As an Administrator, create an Analyst. Sign in as that Analyst and confirm the user-management area is unavailable. Deactivate the Analyst and confirm they can no longer sign in.

**Acceptance Scenarios**:

1. **Given** a signed-in Administrator, **When** they create a user with a name, email, role and temporary password, **Then** the user appears in the user list and can sign in.
2. **Given** an attempt to create a user with an email that already exists (case-insensitive), **When** it is submitted, **Then** it is rejected with a clear message.
3. **Given** an active user, **When** an Administrator deactivates them, **Then** that user's existing sessions stop working within 1 minute and new sign-ins are refused.
4. **Given** an Operations Manager or Analyst, **When** they attempt any user-management action (through the interface or directly), **Then** it is refused as forbidden.
5. **Given** only one active Administrator remains, **When** someone tries to deactivate or demote them, **Then** the action is refused, so the system always keeps at least one Administrator.

---

### User Story 3 - Every significant action leaves an immutable audit record (Priority: P1)

Every change to system state and every security-relevant event creates an audit record. Each record captures who acted, what they did, what it affected, the value before and after, and when. Administrators can browse and filter the audit trail. Nobody, Administrators included, can edit or delete an audit record.

**Why this priority**: Auditability is a non-negotiable constitutional principle, and every later feature depends on this mechanism existing first.

**Independent Test**: Perform a sign-in, a failed sign-in, a user creation and a role change. Open the audit trail as an Administrator and confirm four matching records with correct before/after values. Confirm that no edit or delete operation exists for audit records.

**Acceptance Scenarios**:

1. **Given** an Administrator changes a user's role from Analyst to Operations Manager, **When** the change is saved, **Then** an audit record exists with the actor, action "user.role_changed", the target user, before "Analyst", after "Operations Manager", and a timestamp.
2. **Given** audit records exist, **When** an Administrator filters by actor, action type, target, or date range, **Then** only matching records are shown, newest first, with pagination.
3. **Given** any user (including an Administrator), **When** they attempt to modify or delete an audit record by any means the application offers, **Then** no such capability exists and the attempt fails.
4. **Given** a change to system state, **When** the change succeeds, **Then** its audit record is stored atomically with it. If the audit record cannot be stored, the change is not applied.
5. **Given** a failed sign-in, **When** it occurs, **Then** an audit record captures the attempted email, the outcome and the source address. The password is never recorded.

---

### User Story 4 - Operators can verify the system is healthy (Priority: P2)

An operator, or an automated monitor, can check whether the service is running and whether it can reach its data store, without signing in.

**Why this priority**: Deployment and monitoring need it, but end users can work without it.

**Independent Test**: Query the health check with the data store running (healthy), then with the data store stopped (reports not ready).

**Acceptance Scenarios**:

1. **Given** the service and data store are running, **When** the health check is requested, **Then** it reports healthy, with each dependency's status and the application version.
2. **Given** the data store is unreachable, **When** the readiness check is requested, **Then** it reports "not ready" and names the failing dependency, while the liveness check still reports the process alive.
3. **Given** a health response, **When** it is inspected, **Then** it contains no secrets, connection strings or user data.

---

### User Story 5 - Contributors get a one-command local setup and an automated quality gate (Priority: P2)

A contributor (human or AI implementer) clones the repository and gets a working local environment by following documented steps. Every proposed change is automatically checked for lint, type correctness and passing tests (including tests that use a real database) before it can be merged.

**Why this priority**: Code is written by a lower-cost implementer model, so the automated gate is the main defense against regressions (Constitution Principle V).

**Independent Test**: On a clean machine with the documented prerequisites, follow the quickstart and reach a running sign-in page in under 15 minutes. Open a change that breaks a test and confirm the gate fails. Fix it and confirm the gate passes.

**Acceptance Scenarios**:

1. **Given** a fresh clone and the documented prerequisites, **When** the contributor runs the documented setup steps, **Then** the web app, the backend and the data store start locally, with seeded users for each role.
2. **Given** a change with a lint error, a type error or a failing test, **When** it is proposed for merge, **Then** the automated gate fails and identifies which check failed.
3. **Given** a clean change, **When** it is proposed, **Then** all checks pass, including tests that run against a real, disposable database.

### Edge Cases

- Repeated failed sign-ins for one account: after 5 consecutive failures within 15 minutes, the account is temporarily locked for 15 minutes. The lock is audited, and the user sees the same generic message.
- A user whose role changes while they are signed in: the new permissions apply within 1 minute, at the latest on their next session renewal.
- Email is treated case-insensitively and trimmed of surrounding whitespace.
- A user tries to deactivate themselves: allowed unless they are the last active Administrator.
- Concurrent edits to the same user: the last write wins, and both writes are audited with their own before/after values.
- An audit filter matches tens of thousands of records: results are paginated and the page stays responsive.
- A request carries a tampered or malformed session credential: it is rejected as unauthenticated and never treated as a valid user.
- The data store is down at startup: the service starts, reports "not ready", and recovers automatically once the store is reachable.

## Requirements *(mandatory)*

### Functional Requirements

**Authentication & sessions**

- **FR-001**: System MUST authenticate users by email and password. There is no self-registration; accounts are created only by Administrators or by the initial setup seed.
- **FR-002**: System MUST store passwords only in a salted, slow, one-way hashed form, and MUST require new passwords to be at least 12 characters.
- **FR-003**: System MUST issue short-lived access sessions (15 minutes) that can be renewed silently up to 7 days after sign-in. After that, the user must sign in again.
- **FR-004**: System MUST let a user sign out, invalidating their renewal capability immediately.
- **FR-005**: System MUST lock an account for 15 minutes after 5 consecutive failed sign-ins within 15 minutes.
- **FR-006**: System MUST reject sign-in and session renewal for deactivated users, and MUST stop honoring an existing session within 1 minute of deactivation or role change.
- **FR-025**: A signed-in user MUST be able to change their own password by supplying their current password. Users whose password was set by an Administrator (temporary password) MUST be required to change it before using any other area. A password change MUST end all of that user's other sessions.

**Authorization**

- **FR-007**: System MUST support exactly three roles in this feature: Administrator, Operations Manager, Operations Analyst. Each user has exactly one role.
- **FR-008**: System MUST deny every protected operation by default unless the caller's role is explicitly permitted. The check MUST be enforced by the backend, not only hidden in the interface.
- **FR-009**: Only Administrators MAY create, update, deactivate or reactivate users, change roles, reset passwords, and view the audit trail.
- **FR-010**: System MUST always keep at least one active Administrator.
- **FR-011**: The web shell MUST show navigation entries only for areas the user's role may access, and MUST show a clear "not permitted" page for forbidden routes.

**Audit trail**

- **FR-012**: System MUST record an audit entry for every state-changing operation and for these security events: sign-in success, sign-in failure, sign-out, account lock, session renewal refused, and forbidden access attempts.
- **FR-013**: Each audit entry MUST contain: actor (user, or "system" for automated actions), action code, target type and identifier, before value, after value, timestamp (UTC), request correlation identifier, and source address.
- **FR-014**: Audit entries MUST be append-only. The system MUST expose no way to update or delete them, and the data store MUST enforce this independently of the application.
- **FR-015**: A state change and its audit entry MUST succeed or fail together.
- **FR-016**: Audit entries MUST NOT contain passwords, password hashes, session credentials or other secrets.
- **FR-017**: Administrators MUST be able to list audit entries newest-first with pagination and filter by actor, action code, target, and date range.
- **FR-018**: The audit mechanism MUST be reusable by later features, so a new state-changing operation can be audited without duplicating audit logic.

**Health**

- **FR-019**: System MUST expose an unauthenticated liveness check (process up) and readiness check (data store reachable), including each dependency's status and the application version, and MUST NOT expose secrets.

**Shared contracts & quality gate**

- **FR-020**: Every request and response payload of every endpoint in this feature MUST be defined once as a shared validated schema used by both the backend and the web app. Invalid payloads MUST be rejected with a structured error describing each invalid field.
- **FR-021**: Errors returned to clients MUST use one consistent structure (code, message, optional field details, correlation identifier) and MUST NOT leak stack traces or internal details.
- **FR-022**: The repository MUST provide documented local setup that starts the data store, applies schema migrations, and seeds one active user per role with documented development-only credentials.
- **FR-023**: An automated gate MUST run lint, type checks, unit tests, and end-to-end tests against a real disposable database on every proposed change and on the main branch, and MUST block merging on failure.
- **FR-024**: Every endpoint in this feature MUST have at least one end-to-end test covering its success path and its authorization failure.

### Key Entities

- **User**: a person who can sign in. Attributes: display name, email (unique, case-insensitive), role, status (active/deactivated), failed sign-in counter, lock-until time, created/updated timestamps.
- **Role**: one of Administrator, Operations Manager, Operations Analyst. It determines which operations and areas are permitted. In this feature it is a fixed set, not user-defined.
- **Session**: a user's authenticated period. It consists of a short-lived access credential and a revocable renewal credential, with issue time, expiry and revocation status.
- **Audit Entry**: an immutable record of one action or security event, with the attributes listed in FR-013. It references the actor and the target but survives even if they are later deactivated.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A seeded user can go from opening the application to seeing their role-appropriate home area in under 30 seconds.
- **SC-002**: 100% of protected operations refuse unauthenticated callers and callers with a disallowed role, verified by automated tests covering every operation × role combination.
- **SC-003**: 100% of state-changing operations in this feature produce exactly one matching audit entry, verified by automated tests. Zero audit entries can be modified or deleted through any application path or by direct data-store update under the application's credentials.
- **SC-004**: A new contributor following the documented setup reaches a working local sign-in page in under 15 minutes.
- **SC-005**: The automated quality gate completes in under 10 minutes and blocks 100% of changes that fail lint, type checks or tests.
- **SC-006**: Audit trail queries over 100,000 entries return the first filtered page in under 2 seconds.
- **SC-007**: Health checks respond in under 1 second and correctly report "not ready" within 10 seconds of the data store becoming unavailable.

## Assumptions

- Initial users are internal operators of a single organization. Multi-tenancy, SSO/OAuth, multi-factor authentication, self-service password reset by email, and user-defined roles are out of scope for this feature and may follow later.
- The three roles (Administrator, Operations Manager, Operations Analyst) cover the MVP. Other personas from Product Overview §38 (Finance Ops, Customer Success, etc.) are deferred.
- For now, Operations Manager and Operations Analyst have identical permissions because no operational features exist yet. Later features will differentiate them.
- The web shell shows placeholder navigation entries (Home, Investigations, Graph Explorer, Exceptions, Admin) so later features have a frame to plug into. Only Home and the Admin area (Users, Audit) are functional in this feature.
- Audit retention is indefinite for the MVP. Archival policy is deferred.
- Development seed credentials are for local and testing use only and MUST NOT be present in production configuration.
- Production deployment and hosting are out of scope (covered by the later "production hardening" feature). This feature targets local development and the automated gate.
- The technology stack is fixed by the project constitution and CLAUDE.md, and is decided in the implementation plan rather than in this spec.
