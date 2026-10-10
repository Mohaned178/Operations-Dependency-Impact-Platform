# Specification Quality Checklist: Risk Detection and SLA Management

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
  - the examples used absolute risk numbers (RSK-10001…), which depend on the order risks are raised across both seeded scenarios; examples now name the entity and the number is asserted only relative to raise order (contracts § Numbering);
  - Story 3 claimed that clearing the payment lowers the order's SLA risk; the order's longest unresolved dependency would still be the approval (same unresolved time), so the sentence now only says the dependent risks are reassessed;
  - "missing inputs" was undefined for confidence; the Edge Cases and FR-012 now say a missing input scores 0 and never lowers confidence.
- References to "shared, validated schemas", end-to-end tests and audit records follow the wording of features 003 to 008. They are product constraints from the constitution, not implementation choices.
- The reference figures (Order #18492 at 2026-09-30T03:12:00Z: 6h of 24h remaining, Payment PAY-88213 unresolved 17h 7m, 1 downstream shipment, score 73) are derived from the 002 seed scenario (E1 order.created 09:12; PAY-88213 PENDING observed 10:05; SHP-77120 DEPENDS_ON Order #18492) and the reference SLA term SHIP-24H (FR-040). Contracts fixtures K1–K10 give the full derivations.
- No clarification markers. Decisions taken as documented defaults (see Assumptions), any of which can be revisited with `/speckit-clarify`:
  - SLA terms are transcribed by Administrators against contracts (no machine-readable terms in source data); source SLA records with `dueBy` are tracked too;
  - only orders can be governed by a term in this version;
  - the "as of" time drives time arithmetic only, not a historical replay (005's pattern);
  - one SLA status vocabulary and at-risk rule shared with 007; 007's "SLA due" is the case's resolution SLA and stays separate from contract commitments (FR-005);
  - score = weighted band points, thresholds HIGH ≥ 70 / MEDIUM ≥ 40 / LOW ≥ 20, confidence = sensitivity to non-source links, fallbacks and source conflicts;
  - risks are episodes; no acknowledge/snooze/dismiss;
  - auto-created exceptions: disabled by default, High severity, type mapping per rule, skip when the entity is already linked to an unresolved exception, at most 20 per evaluation;
  - no notifications about risks themselves.
- All items pass.
