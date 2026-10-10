# Feature Specification: Root-Cause Analysis

**Feature Branch**: `005-root-cause-analysis`
**Created**: 2026-10-06
**Status**: Draft
**Input**: User description: "Root-cause analysis (Product Overview §10, §18, §30, §41, §58). For any blocked or delayed entity, produce a causal chain classified as Symptom → Immediate Blocker → Upstream Cause(s) → Deeper Root Cause, derived deterministically from the dependency graph and entity states (rule-based, no AI). Each step lists the entity, its state, the linking relationship, the evidence (source records, events, documents, manual notes), and its origin and confidence. Overall confidence is computed by explicit, inspectable rules (e.g. weakest-link of hop confidences, lowered when evidence is missing or stale) and shown as HIGH/MEDIUM/LOW with reasons. When evidence is insufficient, the result must say so instead of guessing. Users can attach manual evidence notes (audited). Output is also rendered as a plain-language explanation ("Order #18492 is blocked because …"). For the §39 seed scenario the root cause must be "Budget Code Missing" with evidence from the contract, payment record and approval record."

## Overview

Feature 003 answers "What is blocking this?" with structural blocking paths: every unsatisfied entity between the start and the deepest blocker. That tells a user **where** the chain ends. It does not yet tell them **what the problem is**, how sure OpsGraph is, or what proves it.

This feature turns blocking paths into a **root-cause analysis** (Product Overview §10, §41, §58). For any blocked or delayed entity, OpsGraph produces a causal chain in four roles:

- **Symptom**: what the user sees (Shipment SHP-77120 is DELAYED).
- **Immediate Blocker**: the direct reason it cannot continue.
- **Upstream Cause(s)**: why the immediate blocker exists.
- **Root Cause**: the deepest recorded reason, named in operational terms ("Budget Code Missing").

Every step shows its entity, state, the relationship that links it, the evidence behind it and that evidence's origin and confidence. The analysis carries one overall confidence (HIGH, MEDIUM or LOW) computed by a fixed, published set of rules, and every rule's outcome is shown. When the evidence is not strong enough, the analysis says so in plain words instead of naming a cause as fact.

Users can attach **manual evidence notes** to entities and relationships to support, dispute or add context to a step. Notes are audited, never change source data, and are shown as manual evidence.

The analysis is computed on demand from the graph, the states, the events and the notes. It uses no probabilistic or AI component.

It does **not** deliver impact metrics, risk scoring, exceptions, investigations, recurring-root-cause detection, document upload or conflict resolution. Those are later features.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - "Why is this stuck?" answered as a classified, evidenced causal chain (Priority: P1)

An Operations Analyst opens Order #18492, which is BLOCKED. At the top of its Entity 360 page, a **Root cause** section answers the question without any further action:

> **Root cause: Budget Code Missing** · Confidence **HIGH**
>
> Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING. Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED. Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.
>
> Evidence: Order #18492 (OMS 18492), Order #18492 (ERP SO-18492), Contract CON-3982 (ContractMgmt CON-3982), Payment PAY-88213 (Payments PAY-88213), Finance approval APR-2291 (FinanceApprovals APR-2291), Budget code for Order #18492 (FinanceApprovals BR-18492); 7 operational events.

Below the text, the chain is shown as an ordered list of steps, each labeled with its role:

| Role | Entity | State | Linked by |
|---|---|---|---|
| Symptom | Order #18492 | BLOCKED | — |
| Immediate Blocker | Payment PAY-88213 | PENDING | Order #18492 REQUIRES Payment PAY-88213 (SOURCE / HIGH) |
| Upstream Cause | Finance approval APR-2291 | BLOCKED | Payment PAY-88213 REQUIRES Finance approval APR-2291 (SOURCE / HIGH) |
| Root Cause | Budget code for Order #18492 | MISSING | Finance approval APR-2291 REQUIRES Budget code for Order #18492 (SOURCE / HIGH) |

Each step can be expanded to show its evidence: the source records behind its state and its linking relationship, the operational events that mention it, the records that define the requirement it fails (for the Budget code, Contract CON-3982 and its clause "Orders above 10,000.00 USD require finance approval with a budget code"), and any manual notes. The confidence badge expands to show every confidence rule, whether it applied, and why.

**Why this priority**: "Why is this stuck?" is the core product question (§41), and the §39 investigation's headline is its root cause. This is the first feature that names a cause, rates it and proves it.

**Independent Test**: Seed the reference scenario. Sign in as an Analyst, open Order #18492 and Shipment SHP-77120, and check the Root cause section against scenarios 1 to 4, with the evaluation time fixed at 2026-09-29T16:00:00Z. Repeat each analysis 100 times through the service interface with the same evaluation time and confirm identical results.

**Acceptance Scenarios**:

Unless stated otherwise, scenarios 1 to 5 use the evaluation time **2026-09-29T16:00:00Z**, shortly after the seeded observations.

1. **Given** the seeded reference scenario, **When** a root-cause analysis is requested for Order #18492, **Then**:
   - there is exactly one root cause, labeled **"Budget Code Missing"**, on Budget code for Order #18492 (MISSING);
   - the steps and roles are those in the table above, with Payment PAY-88213 as the Immediate Blocker (FR-008);
   - the root cause's evidence includes the source records of Contract CON-3982, Payment PAY-88213 and Finance approval APR-2291;
   - the overall confidence is **HIGH**;
   - the explanation begins "Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING."
2. **Given** the same analysis, **When** its confidence is shown, **Then** every confidence rule in FR-017 is listed with its outcome. The OMS and ERP states of Order #18492 (BLOCKED and PENDING) are reported as a source disagreement that does not lower confidence, because both are unsatisfied states. The root cause is corroborated by event EVT-FA-3002 ("Approval cannot proceed: required budget code is missing").
3. **Given** the seeded scenario, **When** an analysis is requested for Shipment SHP-77120, **Then**:
   - Symptom: Shipment SHP-77120, DELAYED;
   - Immediate Blocker: Order #18492, BLOCKED;
   - Upstream Causes: Payment PAY-88213 (PENDING), then Finance approval APR-2291 (BLOCKED);
   - Root Cause: "Budget Code Missing", overall confidence **HIGH**;
   - an **alternative chain** to the same root cause is listed below the primary one, through "Payment PAY-88213 BLOCKS Shipment SHP-77120" (MANUAL / MEDIUM), with that relationship's basis. It does not lower the analysis's confidence, because it is not the primary chain.
4. **Given** the seeded scenario, **When** an analysis is requested for Acme Corp delivery SLA (AT_RISK), **Then** the root cause is again "Budget Code Missing", the overall confidence is **MEDIUM**, and the reasons state that step 1 rests on an inferred relationship (SLA DEPENDS_ON Shipment SHP-77120, INFERRED / MEDIUM). The explanation text says the link is inferred.
5. **Given** Warehouse WH-EAST-02 (ACTIVE, no unsatisfied dependency), **When** an analysis is requested, **Then** the result states that the entity is not blocked and that no root cause applies, and names the searched depth.
6. **Given** the seeded scenario, **When** the analysis for Order #18492 uses the evaluation time 2026-10-06T12:00:00Z (more than 72 hours after the seeded observations), **Then** the overall confidence is **MEDIUM**, and the stale-evidence reason names the stale steps' observation times, the evaluation time and the 72-hour threshold. The root cause and its evidence are unchanged.
7. **Given** any analysis, **When** it is repeated against unchanged data with the same evaluation time, **Then** every step, role, label, evidence item, rule outcome, confidence and sentence is identical.

---

### User Story 2 - Inspectable confidence and honest uncertainty (Priority: P1)

An Operations Manager is about to escalate a cause to Finance and wants to know how far to trust it. They open the confidence details of an analysis and see each rule listed, for example:

- **Weakest link**: the weakest step is SOURCE / HIGH → starts at HIGH.
- **Unknown state**: no step has an UNKNOWN state → not applied.
- **Stale evidence**: every step was observed less than 72 hours before the evaluation time → not applied.
- **Source disagreement**: Order #18492: OMS BLOCKED, ERP PENDING — both unsatisfied → noted, not applied.
- **Corroboration**: the root cause's state is corroborated by event "Approval cannot proceed: required budget code is missing" → not applied.
- **Disputed**: no active disputing note → not applied.

When the evidence is weak, the analysis does not pretend otherwise. If the root cause's state is UNKNOWN, if the search stopped at the depth limit, if the chain runs in a cycle, or if the overall confidence is LOW, the headline reads **"Possible root cause — insufficient evidence"**, and the text says "may be blocked because…" and lists what is missing.

**Why this priority**: The product must never present inference as fact (§10, §30) and must have no opaque scores (§15, §58). Without inspectable confidence, Story 1's answer cannot be trusted.

**Independent Test**: Build small graphs (outside the seed) that trigger each rule in FR-017 one at a time, plus combinations. For each, check the overall confidence, the listed reasons and the headline wording against FR-017 to FR-020.

**Acceptance Scenarios**:

1. **Given** a chain whose hops are SOURCE / HIGH, SOURCE / HIGH and INFERRED / LOW, **When** it is analyzed, **Then** the overall confidence is LOW, the headline says the evidence is insufficient, and the reason names the inferred step.
2. **Given** a chain whose deepest entity has state UNKNOWN, **When** it is analyzed, **Then** that entity is presented as a "possible root cause (state unknown)", the overall confidence is LOW, and no sentence states it as fact.
3. **Given** a chain that reaches the depth limit while the last entity still has followable dependencies, **When** it is analyzed, **Then** the root cause is labeled "deepest cause found within depth N", the overall confidence is at most MEDIUM, and the text says the true cause may lie deeper.
4. **Given** an entity that is BLOCKED but has no unsatisfied or unknown dependency at all, **When** it is analyzed, **Then** the result says that OpsGraph has no recorded dependency that explains the state, shows the entity's own state evidence and events, and names no root cause.
5. **Given** a chain where one step's sources disagree on whether it is satisfied (for example one source ACTIVE, another BLOCKED), **When** it is analyzed, **Then** both values are shown and confidence is lowered one level with that reason.
6. **Given** a step whose current-state observation is stale under FR-017, **When** it is analyzed, **Then** confidence is lowered one level and the reason names the step, its observation time and the staleness threshold.
7. **Given** an entity with two distinct root causes, **When** it is analyzed, **Then** both are listed as separate candidates, each with its own chain, label, evidence and confidence. The text says "2 possible root causes" and never "the root cause".

---

### User Story 3 - Attach manual evidence notes (Priority: P2)

An Operations Analyst calls the Finance team and learns that the budget code was requested from the account manager yesterday. They open the Budget code step of the analysis and add a note: stance **Supports**, text "Finance confirmed the budget code was never submitted; requested from account manager on 2026-09-30", reference "Call with Finance, ticket FIN-4410". The note appears immediately on that step as manual evidence, with author and time.

Later a colleague finds that the Approval record is out of date and adds a **Disputes** note on the relationship "Finance approval APR-2291 REQUIRES Budget code for Order #18492". The analysis's confidence drops one level, and the reason names the disputing note. When the note's author retracts it with a reason, the confidence returns to its previous level. The note remains visible as retracted.

Every addition and retraction appears in the audit trail.

**Why this priority**: Manual knowledge often fills gaps that source systems miss (§18). It is valuable but builds on Stories 1 and 2.

**Independent Test**: As an Analyst, add a Supports note and a Disputes note to seeded steps, then retract the Disputes note. Check the analysis and the audit trail after each action against the scenarios below.

**Acceptance Scenarios**:

1. **Given** a signed-in user of any role, **When** they add a note to an entity or relationship with a stance, text and optional reference, **Then** the note is stored with its author and time and appears on every analysis step that shows that entity or relationship. An audit record captures the actor, action, target and the note's content.
2. **Given** an active Disputes note on a step of the primary chain, **When** the analysis is computed, **Then** the overall confidence is lowered one level and the reason quotes the note's author, time and the start of its text.
3. **Given** a Supports or Context note, **When** the analysis is computed, **Then** the note is shown as manual evidence and confidence is unchanged.
4. **Given** a note, **When** anyone other than its author or an Administrator tries to retract it, **Then** the attempt is refused. **When** its author or an Administrator retracts it with a reason, **Then** it stops affecting confidence, remains visible as retracted with the reason, and an audit record is written.
5. **Given** a note, **When** anyone tries to edit or delete it, **Then** no such capability exists. Corrections are made by retracting and adding a new note.
6. **Given** invalid input (empty text, text over the limit, unknown stance, nonexistent entity or relationship), **When** a note is submitted, **Then** it is refused with a validation error naming the field, and nothing is stored or audited as a change.

---

### Edge Cases

- **Start entity is satisfied with blockers** (for example an AT_RISK SLA): the analysis runs. The Symptom is the entity's own state ("at risk").
- **Start entity is satisfied with no blockers**: the result says "not blocked; no root cause applies" (Story 1, scenario 5).
- **Chain of one hop**: the single blocking entity is both the Immediate Blocker and the Root Cause. The step shows both roles. There are no Upstream Causes.
- **Chain of two hops**: Immediate Blocker and Root Cause, no Upstream Causes.
- **Several chains to the same root cause**: one candidate, with the highest-ranked chain (feature 003, FR-016) as the primary chain and the others as alternative chains.
- **Branching causes**: each distinct deepest blocker is its own root-cause candidate (Story 2, scenario 7).
- **Truncated blocker search** (feature 003, FR-021, more than 100 paths): the analysis says it is based on a truncated search, and confidence is at most MEDIUM.
- **Cycle**: a root cause that is flagged as part of a dependency cycle (feature 003) is presented as "circular dependency" with LOW confidence.
- **Root-cause entity without a requirement field**: the label uses the generic rule in FR-012 ("Payment PAY-88213 Pending").
- **Very many events on one step**: evidence lists the 20 most recent events per step, newest first, states the total, and links to the entity's timeline.
- **Note on an entity that is not on the current chain**: it is stored and shown on that entity's page, and affects any later analysis whose chain includes it.
- **Data changes between viewing and adding a note**: the note is attached to the entity or relationship, not to a computed analysis, so it stays valid. The analysis is recomputed on the next view.
- **Unauthenticated caller**: refused for analyses and notes.
- **Nonexistent entity**: refused as not found. An invalid depth or evaluation time is refused with a validation error.

## Requirements *(mandatory)*

### Functional Requirements

**Scope and derivation**

- **FR-001**: System MUST produce a root-cause analysis for any entity on request. It MUST be derived only from the blocker tracing of feature 003 (same depth rules, default 6, range 1 to 10), current entity states, source records, events and manual notes, using fixed rules. No probabilistic or AI component MAY be used.
- **FR-002**: Each distinct **deepest blocker** found by blocker tracing MUST become one **root-cause candidate**. Its **primary chain** is the highest-ranked blocking path that ends at it (feature 003, FR-016). Every other blocking path ending at it MUST be listed as an **alternative chain**.
- **FR-003**: Candidates MUST be ordered by overall confidence (HIGH first), then by the feature 003 ranking of their primary chains.
- **FR-004**: An analysis MUST take an **evaluation time**, defaulting to the time of the request. Given identical data, query and evaluation time, the result MUST be identical in content and order, except for its computed time.
- **FR-005**: Analyses MUST be computed on demand and not stored. Only manual notes are stored by this feature.

**Causal roles**

- **FR-006**: Each step of a chain MUST be assigned one or more roles:
  - **Symptom**: the start entity, with its own current state;
  - **Immediate Blocker**: see FR-008;
  - **Upstream Cause**: every step between the Immediate Blocker and the Root Cause;
  - **Root Cause**: the last step of the chain.
- **FR-007**: A step that holds two roles (for example a one-hop chain) MUST show both.
- **FR-008**: The Immediate Blocker MUST be the first step after the Symptom: the direct blocker of feature 003, FR-008 (Product Overview §10, §41). For Order #18492 this is Payment PAY-88213. For Shipment SHP-77120 it is Order #18492.
- **FR-009**: An entity with state UNKNOWN MUST be presented as a "possible" cause in its role, never as a confirmed one.

**Steps and evidence**

- **FR-010**: Each step MUST show:
  - the entity: identifier, type, display name;
  - its current state, with the source system and observation time of that state, and each source system's latest state when they disagree;
  - the linking relationship exactly as recorded, with every assertion's origin, confidence, basis, source system, source identifier and observation time (feature 003, FR-012), and the hop's effective origin and confidence;
  - its evidence (FR-011).
- **FR-011**: Each step's evidence MUST be gathered by these fixed rules, and each item MUST state which rule included it:
  1. **State record**: the source record that set the entity's current state, plus the latest record from each other source system for that entity.
  2. **Relationship record**: the source record of every assertion of the linking relationship.
  3. **Requirement source**: the source records of entities that define or govern the step's entity (through DEFINES or GOVERNS relationships), including their attributes. For Budget code for Order #18492 this includes Contract CON-3982 and its clause.
  4. **Events**: operational events whose subject or related entities include the step's entity, newest first, at most 20, with the total count.
  5. **Manual notes**: active and retracted notes on the step's entity or its linking relationship.

  Each evidence item MUST show its source system, source identifier and observation time (or author and time for notes), and its origin: SOURCE for source records and events, INFERRED for inferred relationship assertions, MANUAL for notes and manual assertions.
- **FR-012**: The Root Cause MUST carry a short **label** produced by a fixed rule, and the rule used MUST be shown:
  - if the entity names a required field (as BudgetRequirement entities do), the label is that field in words followed by the state in words: "budgetCode" + MISSING → **"Budget Code Missing"**;
  - otherwise, the entity's display name followed by its state in words: "Payment PAY-88213 Pending".
- **FR-013**: Each candidate MUST also carry a **key evidence** list: the de-duplicated state records and requirement-source records of every step in its primary chain, in chain order.

**Overall confidence**

- **FR-014**: Each candidate MUST have an overall confidence of HIGH, MEDIUM or LOW, computed only from its primary chain by the rules in FR-017, in order.
- **FR-015**: The result MUST list every rule in FR-017 with its outcome (applied or not applied), the step or evidence it refers to, and the confidence after it. Confidence MUST never be expressed as a percentage or score.
- **FR-016**: Alternative chains MUST be shown with their own weakest-link confidence but MUST NOT change the candidate's overall confidence.
- **FR-017**: Overall confidence MUST be computed as follows:
  1. **Weakest link**: start from the lowest effective confidence among the primary chain's hops.
  2. **Unknown state**: if any step's state is UNKNOWN, set LOW.
  3. **Cycle**: if the root cause is flagged as part of a dependency cycle, set LOW.
  4. **Depth or search limit**: if the root cause is only the deepest found within the depth limit, or the blocker search was truncated, cap at MEDIUM.
  5. **Stale evidence**: if any step's current-state observation is more than **72 hours** older than the evaluation time (FR-004), lower one level. The reason MUST name the step, its observation time, the evaluation time and the threshold.
  6. **Classification disagreement**: if, for any step, source systems' latest states disagree on whether the entity is satisfied, unsatisfied or indeterminate (feature 003, FR-006), lower one level. Disagreement within one class (for example BLOCKED vs PENDING) MUST be reported but MUST NOT lower confidence.
  7. **Uncorroborated root cause**: if the root cause's state rests on a single source record and no event names the root-cause entity, lower one level.
  8. **Disputed**: if any active Disputes note is attached to an entity or linking relationship of the primary chain, lower one level.

  Rules 5 to 8 each lower confidence at most once, however many steps trigger them. Confidence never falls below LOW. Supports and Context notes MUST NOT raise confidence.

**Insufficient evidence**

- **FR-018**: A candidate whose overall confidence is LOW MUST be headed **"Possible root cause — insufficient evidence"**, and its text MUST use "may be … because" phrasing and list what is missing or weak.
- **FR-019**: When the start entity is unsatisfied or indeterminate but blocker tracing finds no blocking path, the result MUST state that no recorded dependency explains its state, MUST show the entity's own state evidence and events, and MUST name no root cause.
- **FR-020**: When the start entity is satisfied and no blocking path exists, the result MUST state that the entity is not blocked and name the searched depth.

**Plain-language explanation**

- **FR-021**: Each candidate MUST come with an explanation generated deterministically from its data alone:
  1. a headline: the label and overall confidence, or the insufficient-evidence heading;
  2. the chain sentences, in the form of feature 003, FR-018 and FR-019 (non-SOURCE hops stated as inferred or manual, with confidence and basis; UNKNOWN states as "whose state is unknown");
  3. one sentence per applied confidence rule;
  4. an evidence sentence naming the key evidence records and the number of events.
- **FR-022**: When there are several candidates, the result MUST begin with a one-line summary: the start entity's state and the number of candidates ("Shipment SHP-77120 is DELAYED. 1 root cause found: Budget Code Missing (HIGH).").

**Manual evidence notes**

- **FR-023**: Any signed-in user MUST be able to attach a note to an existing entity or relationship. A note has:
  - a stance: **Supports**, **Disputes** or **Context**;
  - text, 1 to 2,000 characters;
  - an optional reference, up to 500 characters (for example a document name, ticket or link);
  - its author and creation time, set by the system.
- **FR-024**: Notes MUST be immutable. They can only be retracted, with a reason of 1 to 500 characters, by their author or an Administrator. Retracted notes stay visible, marked as retracted with who, when and why.
- **FR-025**: Adding and retracting a note MUST each write an audit record (actor, action, target, before, after, time), stored atomically with the change.
- **FR-026**: Notes MUST NOT change any entity, state, relationship, event or source record.
- **FR-027**: Each entity's and relationship's notes MUST be listable, newest first, with pagination.

**Entity 360 integration**

- **FR-028**: The Entity 360 page MUST show a **Root cause** section after Current state and before Blockers. It shows:
  - the FR-022 summary;
  - each candidate's headline, explanation and chain as a list of steps with roles;
  - per step, expandable evidence grouped by FR-011 rule;
  - per candidate, expandable confidence rules (FR-015) and alternative chains;
  - an action to add a note on each step's entity and linking relationship.
- **FR-029**: When the entity has at least one candidate, the first candidate's headline and explanation MUST be visible without scrolling at 1366×768. When there is none, the section MUST be one line.
- **FR-030**: Every entity named in the section MUST link to its Entity 360 page.
- **FR-031**: The analysis MUST be presented as text and structured lists. Any graph view of it MUST be accompanied by them.

**Access, contracts and tests**

- **FR-032**: All signed-in roles MUST be able to request analyses and add notes. Unauthenticated callers MUST be refused. Requesting an analysis MUST change no data.
- **FR-033**: Every new request and response payload MUST be defined once as a shared, validated schema used by the backend and the web app. Every new endpoint MUST have end-to-end tests for its success path, authentication failure and validation failure.
- **FR-034**: Automated tests MUST cover at least:
  - each confidence rule in FR-017 alone and in combination;
  - each role assignment case (one hop, two hops, longer chains, UNKNOWN steps);
  - both label rules in FR-012;
  - each evidence rule in FR-011;
  - note creation, retraction, permission refusal and auditing;
  - every acceptance scenario in Stories 1 to 3 against the seeded reference scenario.

### Key Entities

- **Root-Cause Analysis**: the result for one start entity. It echoes the query (entity, depth, evaluation time), states when it was computed and whether the blocker search was truncated, and contains a summary and zero or more candidates, or an insufficient-evidence or not-blocked statement. Not stored.
- **Root-Cause Candidate**: one deepest blocker treated as a cause. It has a label and the rule that produced it, a primary chain, alternative chains, key evidence, an overall confidence with its rule outcomes, and an explanation.
- **Causal Step**: one entity in a chain, with its role(s), state, linking relationship and evidence.
- **Evidence Item**: a source record, relationship assertion, event or note supporting a step, with its origin, provenance and the rule that included it.
- **Confidence Rule Outcome**: one rule from FR-017, whether it applied, what it refers to, and the confidence after it.
- **Evidence Note**: a stored, immutable manual note on an entity or relationship, with stance, text, optional reference, author, time and optional retraction (who, when, why).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Starting from the entity list, a signed-in user can open Order #18492 and read its root cause, its confidence and the three key source records (contract, payment, approval) in under 30 seconds, without leaving the Entity 360 page.
- **SC-002**: On the seeded reference scenario, 100% of the acceptance scenarios in Stories 1 to 3 pass in automated tests. Every analysis of Order #18492, Shipment SHP-77120 and the 4 delivery SLAs names "Budget Code Missing" as its root cause.
- **SC-003**: In a data store with 50,000 entities and at least 150,000 relationships, an analysis for one entity whose blocking chain is 6 hops deep returns in under 1.5 seconds at the 95th percentile over 20 runs.
- **SC-004**: 100 consecutive analyses of each acceptance entity against unchanged data and the same evaluation time produce identical results (excluding computed time).
- **SC-005**: 100% of analyses list every confidence rule with its outcome. 100% of LOW-confidence candidates use the insufficient-evidence heading and "may be" phrasing. Both verified by automated tests over the seed and generated graphs.
- **SC-006**: 100% of note additions and retractions produce an audit record, and 0 notes can be edited or deleted, verified by automated tests.

## Assumptions

- **Scope boundaries**: Out of scope, for later features:
  - impact metrics (orders and customers affected, SLA risks, revenue exposure), risk scoring, exceptions and investigations;
  - recurring-root-cause detection (§32);
  - formal conflict flagging and resolution (§29, §53); this feature reports disagreements and uses them in confidence only;
  - upload or storage of documents, files and screenshots. "Documents" are represented by source records of document-like entities (for example the contract and its clause) and by a note's free-text reference.
- **Root cause is the deepest recorded cause**: OpsGraph can only name causes that exist in its data. A cause outside the recorded graph is out of reach, and FR-019 makes that visible.
- **No percentages**: §41 shows "Confidence: 92%". This spec uses the HIGH/MEDIUM/LOW levels from §30 with listed reasons, because a numeric score would be opaque (Constitution Principle III, §58).
- **Manual notes never raise confidence**: supporting notes are displayed but cannot upgrade a conclusion, so manual input cannot turn an inference into an apparent fact. Disputing notes can lower confidence, because doubt should always be visible.
- **Note permissions**: every signed-in role can add notes, because analysts gather this information. Only the author or an Administrator can retract.
- **Primary chain only for confidence**: alternative chains add context but do not raise or lower a candidate's confidence, which keeps the rules simple and predictable.
- **Immediate Blocker definition**: §39 lists "Immediate Blocker: Finance approval" for Order #18492. This spec follows §10 and §41, where the Immediate Blocker is the first step after the symptom (FR-008), so it is Payment PAY-88213 for Order #18492. Finance approval APR-2291 is an Upstream Cause. This keeps the role consistent with feature 003's direct blocker for every start entity.
- **Staleness**: staleness is measured against the evaluation time with a single 72-hour threshold for all entity types (FR-017, rule 5). The seeded data was observed on 2026-09-29, so analyses evaluated at the current time report it as stale and show MEDIUM. Acceptance tests fix the evaluation time. Per-type thresholds and source-sync freshness (§52) are later refinements.
- **Existing foundation**: sign-in, roles, audit, the error format, shared schemas, the entity model, the reference seed, blocker tracing and the Entity 360 page come from features 001 to 003 and are reused. This feature adds the Root cause section that feature 003's FR-032 deferred.
- **Performance dataset**: the 50,000-entity graph from features 002 and 003 is reused.
