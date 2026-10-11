# Specification Quality Checklist: Production Hardening and Free-Tier Deployment

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-07
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Validation iteration 1 found issues, now fixed:
  - the feature description names products (Oracle Cloud, Docker Compose, Caddy, Playwright, PostgreSQL, `pg_dump`). The hosting choice is a binding user decision, so it is stated in the Overview and recorded in Assumptions ("Hosting decision"); the requirements are written provider-neutrally ("container images", "entry point", "object store", "browser test") so that the portability requirement (FR-004) stays checkable. Products appear in plan.md and research.md;
  - "zero-downtime migration strategy" had no measurable meaning; FR-014/FR-015 and SC-002 define it (expand-then-contract enforced by the gate; no failed request at one request per second across 3 deployments) and the Assumptions bound it to a single server (not high availability);
  - "rate limiting on auth and write endpoints" had no limits; FR-017 publishes a default table and FR-018 the refusal format; auditing refusals was rejected with a reason (append-only audit flooding) consistent with Constitution IV, which covers mutations;
  - "proving the dashboard, tracing and impact targets" did not say under what load; SC-010 reuses the published targets of 003 (SC-003/SC-004), 005 (SC-003), 006 (SC-003) and 010 (SC-005) and adds the concurrency (20 users, 5 minutes) and error budget;
  - "CD deploys main to staging": production promotion was unspecified; FR-010 makes it a manual action on a release already proven on staging (Assumptions);
  - "daily backups with a tested restore": FR-034 to FR-037 add retention, the pre-deploy backup, the weekly automated drill and the restore audit record (Constitution IV);
  - SC-006 mentions "a public security-header scanner" generically; no product is named.
- References to "shared, validated schemas", end-to-end tests and audit records follow the wording of features 003 to 010. They are product constraints from the constitution, not implementation choices.
- No clarification markers. Decisions taken as documented defaults (see Assumptions), any of which can be revisited with `/speckit-clarify`:
  - staging and production as two isolated environments on the one free server, sharing only the entry point;
  - production deployment is a manual promotion of a staging release;
  - zero downtime is defined for one server (no HA, no failover);
  - in-memory, per-server rate-limit counters; refusals logged and counted, not audited;
  - backups: daily full + pre-deploy, RPO 24 h, retention 7 daily + 4 weekly (production), 3 daily (staging), 30 days off-site, encrypted on the server; weekly drill on production backups only;
  - metrics private (not routed by the entry point), monitoring tools optional and off by default;
  - error tracking server-side only, off by default, open event format;
  - first Administrator by a server command; demo seed allowed on staging/CI only with a non-default password;
  - full load test on demand outside production, smoke run in the gate.
- All items pass.
