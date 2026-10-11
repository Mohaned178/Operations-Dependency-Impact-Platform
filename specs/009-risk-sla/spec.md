# Feature Specification: Risk Detection and SLA Management

**Feature Branch**: `009-risk-sla`
**Created**: 2026-10-07
**Status**: Draft
**Input**: User description: "Risk detection and SLA management (Product Overview §14, §15, §36, §50). SLA rules come from contracts (e.g. "ship within 24h of order") and attach to entities; compute elapsed time, remaining time and breach status. A rule-based risk engine (no ML) evaluates entities every 5 minutes and on data change, producing Risks with: affected entity, risk type (SLA breach likely, payment unresolved too long, approval delayed, supplier disruption, warehouse capacity pressure, high downstream dependency), score, level (HIGH/MEDIUM/LOW), confidence, and the explicit list of contributing factors with values and weights (e.g. "payment unresolved 4h", "SLA remaining 6h", "2 downstream shipments"). Rules and thresholds are configurable by Admins (audited). Risks & Alerts page with filters and drill-down to Entity 360 and impact. A HIGH risk can optionally auto-create an exception (configurable, audited as a system action). The same graph state must always yield the same scores."

## Overview

Features 003 to 008 answer questions about problems that already exist: what is blocked, why, what it affects, who owns it, and what was concluded. They do not answer §65 question 8, **"What is likely to happen next?"**, and they only start once a user goes looking. Today nobody is told that Order #18492 has six hours left before Acme Corp's 24-hour shipping commitment is broken, or that a payment has been unresolved for seventeen hours while 22 dependent records wait on it.

This feature adds two connected capabilities.

**1. SLA commitments (§36).** A contract's service terms ("orders must ship within 24 hours of being placed") are recorded once as an **SLA term** of that contract. OpsGraph attaches the term to every order the contract governs and runs an **SLA clock** for each: when it started, when it is due, elapsed and remaining time, and its status (On track, At risk, Breached, Met, Missed, Cancelled). SLA commitments that source systems already report as records (the 002 seed's "Acme Corp delivery SLA, due 2026-10-02 17:00") get a clock too.

**2. Risk detection and scoring (§14, §15, §50).** A rule-based engine, with no machine learning, evaluates the graph **every 5 minutes and whenever imported data changes**. Each of six published rules looks at one kind of entity and produces a **risk** when its score reaches the rule's lowest level:

> **Order #18492 · SLA breach likely** · Level **HIGH** · Score **73** · Confidence **HIGH**
> Evaluated as of 2026-09-30 03:12 UTC
>
> | Factor | Value | Weight | Points | Contribution |
> |---|---|---|---|---|
> | SLA remaining | 6h remaining of the 1d SLA window (25%), due 2026-09-30 09:12 | 35 | 80 | 28.0 |
> | Longest unresolved dependency | Payment PAY-88213 unresolved for 17h 7m | 25 | 100 | 25.0 |
> | Warehouse utilization | not available | 15 | 0 | 0.0 |
> | Downstream shipments | 1 (Shipment SHP-77120) | 10 | 50 | 5.0 |
> | Own state | BLOCKED | 15 | 100 | 15.0 |

The score is the weighted sum of the factor points, so a reader can recompute it by hand. The level comes from published thresholds. The confidence states how much the result depends on inferred links, fallbacks or conflicting sources. Rules, weights, bands and thresholds are configurable by Administrators, and every configuration is versioned and audited.

The **same graph state, configuration and evaluation time always give the same risks, scores, levels, confidence and factors** (Constitution III). Every evaluation records the time it evaluated "as of", the graph version it read and the configuration version it used.

A **Risks & Alerts** area lists the current risks with filters and sorting, a feed of recent risk changes, and the SLA commitments. Each risk drills down to its factors and their evidence, to the entity's Entity 360 page and to its impact analysis (006). An Administrator can let a HIGH risk **automatically create an exception** (007), per rule; the exception is created through 007's normal path and audited as a system action.

SLA terminology is reconciled with feature 007 (FR-005): the exception's own **resolution SLA** (how quickly a case must be resolved) and the **SLA commitments** of this feature (what a contract promises the customer) remain different things with different names, but they share one status vocabulary and one at-risk rule.

It does **not** deliver machine-learning or statistical predictions, anomaly detection, historical failure frequency (§32), customer-importance or financial-exposure factors, recommended actions (§33), what-if analysis (§13), email or chat alerts, business-hours or holiday calendars, or importing machine-readable SLA terms from source systems. Those are later features.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See which entities are at risk and why (Priority: P1)

An Operations Manager opens **Risks & Alerts** at the start of the night shift. The list shows the open risks, highest score first. A row reads **"HIGH · 73 · Order #18492 · SLA breach likely · 6h of 24h SLA remaining; Payment PAY-88213 unresolved for 17h 7m; order BLOCKED"**. They open it. The risk page lists every factor with its value, weight, points and contribution, the evidence behind each value (the source records and events, with source system, source id and observation time), the confidence and the reasons for it, and the history of the risk's assessments. Links lead to Order #18492's Entity 360 page, its impact section, the payment that has been unresolved longest, and the existing exceptions for the order.

**Why this priority**: This is the feature's purpose: a risk that is contextual and inspectable (§14, §15) answers "What is likely to happen next?" before the breach happens.

**Independent Test**: Seed the reference scenario, define the reference SLA term (Story 2), and run an evaluation as of 2026-09-30T03:12:00Z. Open the Risks & Alerts list and the risk of Order #18492, and compare every value with the scenarios below and contracts fixtures K1 to K5.

**Acceptance Scenarios**:

1. **Given** the seeded reference scenario with the reference SLA term and an evaluation as of 2026-09-30T03:12:00Z, **When** the risk of Order #18492 is opened, **Then** it is an **SLA breach likely** risk with score 73, level HIGH and confidence HIGH, and its five factors are exactly those in the Overview table, in that order.
2. **Given** the same evaluation, **When** the risks of Payment PAY-88213, Finance approval APR-2291 and Budget code for Order #18492 are opened, **Then** they are **Payment unresolved too long** (PAY-88213) and **Approval delayed** (the other two), each with score 94, level HIGH and confidence HIGH, and each names the time the entity has been unresolved (17h 7m), the tightest downstream SLA commitment (Order #18492, 25% remaining) and the number of currently affected downstream records.
3. **Given** a risk, **When** its score is recomputed by hand from the listed weights and points, **Then** it equals the shown score: the sum of weight × points, divided by 100, rounded half up to a whole number.
4. **Given** a risk, **When** its level is checked against the rule's thresholds shown on the page, **Then** it is HIGH at or above the high threshold, MEDIUM at or above the medium threshold, and LOW at or above the low threshold.
5. **Given** a risk whose factor counts include entities reached only through inferred or manual relationships (for example Shipment SHP-77120's **High downstream dependency** risk, whose SLA count of 4 comes only from inferred links), **When** it is opened, **Then** the confidence is MEDIUM and the reason states which factor depends on non-source links and what its points would be from source facts alone. **When** the level itself would drop without those links, **Then** the confidence is LOW.
6. **Given** the Risks & Alerts list, **When** filters for level, risk type, entity type, confidence, status (open or cleared) and entity are combined, or a sort by score, level or newest is chosen, **Then** the list follows FR-028 and is identical on every repetition against unchanged data.
7. **Given** a risk row, **When** the affected entity is selected, **Then** its Entity 360 page opens; **When** "Impact" is selected, **Then** the entity's impact section (006) opens.

---

### User Story 2 - Track contract SLA commitments on the entities they govern (Priority: P1)

An Administrator opens Contract CON-3982 and records its delivery clause as an **SLA term**: code **SHIP-24H**, name "Ship within 24 hours of order", the clause text quoted from the contract, applying to the **orders** the contract governs, starting at the order's **order.created** event, stopping at a **shipment.departed** or **shipment.delivered** event for the order or when the order is COMPLETED, with a **24-hour** window and the standard **25%** at-risk threshold.

From then on, each of the five Acme Corp orders shows an **SLA commitments** section on its Entity 360 page. Order #18492 at 2026-09-30 03:12 shows: "Ship within 24 hours of order (Contract CON-3982): started 2026-09-29 09:12 (order.created, OMS), due 2026-09-30 09:12; 18h elapsed, 6h remaining; **At risk**." The four other Acme orders have no order.created event, so their clocks start at their first observation, and this fallback is stated on each clock. The Risks & Alerts area has an **SLA commitments** tab listing every clock, most urgent first.

**Why this priority**: §36 requires SLA requirements to be connected to actual process state, and the SLA breach rule (Story 1) depends on these clocks. It reproduces §36's "shipment must happen within 24 hours" on the §39 scenario.

**Independent Test**: On the seeded scenario, create the SHIP-24H term as an Administrator. Check each Acme order's clock against fixture K6 at several evaluation times, including exactly at the at-risk boundary and exactly at the due time. Check that non-Acme orders have no clock from this term and that the audit trail holds the term's creation.

**Acceptance Scenarios**:

1. **Given** the SHIP-24H term on CON-3982, **When** the SLA commitments of Order #18492 are shown as of 2026-09-30T03:12:00Z, **Then** the clock states start 2026-09-29T09:12:00Z (from event order.created, OMS EVT-OMS-1001), due 2026-09-30T09:12:00Z, elapsed 18h, remaining 6h, status At risk, and the term's code, name, contract and clause.
2. **Given** the same term, **When** the clock is evaluated exactly at the at-risk boundary (2026-09-30T03:12:00Z, 25% of the window remaining), **Then** it is At risk; 1 millisecond earlier it is On track; exactly at the due time it is At risk; 1 millisecond after the due time it is Breached. These boundaries are identical to 007's exception SLA rule.
3. **Given** a governed order that reached a stop event or COMPLETED before its due time, **When** its clock is shown, **Then** it is **Met** with the stop time and its source; after the due time it is **Missed**. **Given** a CANCELLED order, **Then** its clock is **Cancelled** and is never at risk.
4. **Given** an order with no start event, **When** its clock is shown, **Then** it starts at the order's first observation and states "Start falls back to the first observation (…) because no order.created event is recorded."
5. **Given** an SLA commitment recorded by a source system as an SLA record with a due time (for example Acme Corp delivery SLA, due 2026-10-02T17:00:00Z), **When** its Entity 360 page is opened, **Then** it shows a clock for that due time, the source's own state (AT_RISK, from ContractMgmt) and, if the source's state and the computed status disagree, a sentence stating both. Neither value replaces the other.
6. **Given** an Administrator, **When** they change a term's window or threshold, or deactivate it, **Then** the change is audited with before and after values, every clock of that term follows the new values from the next evaluation, and a deactivated term produces no clocks. Terms are never deleted.
7. **Given** a non-Administrator, **When** they try to create, change or deactivate an SLA term, **Then** it is refused and the refusal is audited.

---

### User Story 3 - Risks stay current and reproducible (Priority: P2)

Nobody presses a button: OpsGraph evaluates every 5 minutes, and again shortly after each import that changes data. When the payment is approved and imported as ACTIVE, the next evaluation clears the Payment unresolved risk, and the risks that counted the payment are reassessed. An Administrator can also select **Evaluate now**. Every evaluation is listed with its trigger, its "as of" time, the graph and configuration versions it read, how many risks it raised, changed and cleared, and how long it took.

**Why this priority**: §14 asks for continuous monitoring, and Constitution III requires reproducible results. It builds on Stories 1 and 2, which define what an evaluation produces.

**Independent Test**: On the seeded scenario, run two evaluations with the same "as of" time and no data change in between; compare the results byte for byte. Import a change (the payment becomes ACTIVE) and check that an evaluation follows automatically and clears the payment risk. Check the evaluation list and audit trail.

**Acceptance Scenarios**:

1. **Given** unchanged data and configuration, **When** two evaluations are computed as of the same time, **Then** every risk, score, level, confidence, factor value, point and sentence is identical, and so is their order.
2. **Given** the scheduler, **When** the application runs, **Then** an evaluation completes at least every 5 minutes, and at most one evaluation runs at a time; triggers that arrive during a run cause exactly one more run after it.
3. **Given** an import that applies changes, **When** it completes, **Then** an evaluation with trigger "data change" starts within 30 seconds.
4. **Given** an open risk whose rule no longer produces a score at or above its lowest threshold, **When** the next evaluation completes, **Then** the risk is **cleared** with the evaluation's time, stays visible with status Cleared, and a later recurrence opens a new risk with a new number.
5. **Given** an open risk whose level, score, confidence or factor values change, **When** the evaluation completes, **Then** a new assessment is recorded and shown in the risk's history with before and after values. When nothing material changed, no new assessment and no audit record is written.
6. **Given** an Administrator, **When** they select **Evaluate now** with an optional "as of" time, **Then** an evaluation runs as of that time, which must not be earlier than the latest completed evaluation, and they see its result. Anyone else is refused.
7. **Given** the evaluation list, **When** an evaluation is opened, **Then** it shows its trigger, actor (System or the Administrator), "as of" time, start and end times, graph version, configuration version, SLA terms digest, the counts of entities evaluated and risks raised, changed, cleared and open by level, and any auto-created exceptions or failures.

---

### User Story 4 - Administrators tune rules and thresholds (Priority: P2)

The Administrator finds that payments routinely clear within 3 hours, so a payment unresolved for 2 hours should not score 50 points. They open **Admin → Risk rules**, select **Payment unresolved too long**, change the "Unresolved for" bands, and save. The configuration becomes version 2; the change is audited with the rule before and after; the next evaluation uses version 2, and each assessment states the version it used.

**Why this priority**: §15 requires explainable scores, and operations differ between companies; fixed thresholds would be wrong for most. It builds on Story 1's rules.

**Independent Test**: As an Administrator, change a rule's weights, bands, thresholds, enabled flag and auto-exception settings. Check validation errors, the new version, the audit row, and that an evaluation as of a fixed time gives the scores the new configuration implies. As an Analyst, check that every change is refused.

**Acceptance Scenarios**:

1. **Given** the default configuration, **When** any signed-in user opens the rules page, **Then** each of the six rules shows: what it applies to, its enabled flag, every factor with its meaning, weight and point bands, the level thresholds, and its auto-exception setting.
2. **Given** an Administrator, **When** they save a rule change, **Then** a new configuration version is stored with all six rules, the change is audited with that rule's before and after, and the version number increases by one.
3. **Given** a rule change whose weights do not sum to 100, whose bands are not strictly ordered or have points outside 0 to 100, or whose thresholds are not ordered low < medium < high within 1 to 100, **When** it is saved, **Then** it is refused with a validation error naming the field, and nothing is stored or audited.
4. **Given** two Administrators editing from pages loaded at the same version, **When** the second saves, **Then** it is refused as a conflict and they are told to reload.
5. **Given** a disabled rule, **When** the next evaluation runs, **Then** it raises no risks of that type and clears the open ones, stating "rule disabled" as the reason.
6. **Given** a non-Administrator, **When** they try to change a rule, **Then** it is refused and the refusal is audited.

---

### User Story 5 - Follow risk changes and see risk on Entity 360 (Priority: P2)

An analyst investigating Order #18492 sees a **Risk HIGH** badge in the Entity 360 header and a **Risk & SLA** section listing the order's open risks (with score, confidence and top factors) and its SLA commitments. On the **Alerts** tab of Risks & Alerts, a supervisor reads the last 7 days of risk changes, newest first: "Raised: Payment PAY-88213, Payment unresolved too long, HIGH (94)", "Order #18492, SLA breach likely: MEDIUM (40) → HIGH (73)", "Cleared: Warehouse capacity pressure on East Distribution Center 02".

**Why this priority**: §50 asks for proactive visibility, and the Entity 360 page is where users already look (§8). It reuses the risks of Stories 1 to 3.

**Independent Test**: After two evaluations at different times on the seeded scenario, compare the Alerts feed with the audit trail, and the Entity 360 Risk & SLA section with the risk list filtered to that entity.

**Acceptance Scenarios**:

1. **Given** an entity with open risks, **When** its Entity 360 page is opened, **Then** the header shows the highest open risk level, and the Risk & SLA section lists every open risk of the entity (highest score first) with its type, level, score, confidence and its three highest-contributing factors, plus its SLA commitments (Story 2).
2. **Given** an entity without open risks or clocks, **When** its page is opened, **Then** the section is a single line saying so.
3. **Given** risk changes, **When** the Alerts tab is opened, **Then** it lists every risk raised, every level change (up or down) and every clearance of the selected period (default 7 days), newest first, each with time, risk number, entity, type and before and after level and score.
4. **Given** a Contract entity, **When** its page is opened, **Then** the Risk & SLA section lists its SLA terms with the number of clocks per status.

---

### User Story 6 - Let a HIGH risk open an exception automatically (Priority: P3)

The Administrator enables **auto-create exception** for **Payment unresolved too long**, with owner **Finance Operations** and exception type **Failed payment**. At the next evaluation, Payment PAY-88213's HIGH risk creates exception **EX-10002** "Payment PAY-88213: Payment unresolved too long (RSK-…)" (the risk's number), severity High, subject the payment, created by System from the risk. Finance Operations members receive 007's assignment notification. The risk page links to the exception; the exception's history says it was created by System from that risk.

**Why this priority**: It closes the loop from detection to ownership (§16, §35), but it is optional and off by default; every other story works without it.

**Independent Test**: Enable auto-creation for one rule, run an evaluation that makes a risk of that type HIGH, and check the exception, its audit row, the notifications and the risk's link. Run again and check that no second exception is created. Repeat for an entity already linked to an unresolved exception and check that creation is skipped with a stated reason.

**Acceptance Scenarios**:

1. **Given** auto-creation enabled for a rule, **When** an evaluation leaves an open risk of that rule at level HIGH with no auto-created exception, **Then** one exception is created through feature 007's creation rules (number, defaults, root-cause and impact snapshots, links, notifications) with: subject the risk's entity, severity High, the configured type and owner, a title and description built from the risk (FR-036), and creation origin "From risk". Its creation is audited as a System action naming the risk, and the risk records the exception.
2. **Given** the same risk at the next evaluation, **When** it is still HIGH, **Then** no further exception is created for it. A new exception can only come from a new risk after this one is cleared.
3. **Given** a HIGH risk whose entity is already linked, in any role, to an unresolved exception, **When** auto-creation would apply, **Then** no exception is created, and the evaluation records "skipped: entity already linked to EX-…".
4. **Given** an SLA breach likely risk whose commitment is due before 007's default resolution time for a High exception, **When** its exception is created, **Then** the exception's SLA due time is the commitment's due time (FR-005).
5. **Given** auto-creation disabled (the default), **When** risks become HIGH, **Then** no exception is created.
6. **Given** more than 20 auto-creations due in one evaluation, **When** it runs, **Then** only the first 20 by risk score (then risk number) are created, and the evaluation records how many were deferred to the next run.

---

### Edge Cases

- **Evaluation time vs data time**: the "as of" time drives only time arithmetic (elapsed, remaining, durations, event windows). The graph is read as currently stored; this is not a historical replay. A recorded time later than the "as of" time gives a duration of zero, never a negative one.
- **Breached commitments**: an SLA breach likely risk on an already breached clock stays open with the sentence "already breached by …"; it clears when the clock stops (Met or Missed) or is cancelled.
- **Several clocks on one entity**: the most urgent running clock (least remaining share, then earliest due time, then term code) drives the SLA factors; every clock is still listed.
- **Missing inputs**: a factor whose input is absent (for example no warehouse utilization attribute) scores 0 points and is shown as "not available". It never inflates a score. It does not lower confidence, because it can only understate the score; the page says that the score may be understated.
- **Conflicting sources**: when the sources disagree on an entity's state class (for example one reports ACTIVE and another BLOCKED), a factor that uses that state is marked, and confidence is at most MEDIUM. Both values are shown; neither is chosen silently.
- **Source-reported SLA state vs computed status**: shown side by side with a disagreement sentence (Story 2 scenario 5).
- **Inferred links**: counts state how many entities are reached only through inferred or manual links (FR-021).
- **Large graphs**: downstream and upstream reach are bounded by each rule's depth (default 6 downstream, 3 upstream) and the platform's 10,000-entity exploration limit; a factor that hit the limit states "at least".
- **Cycles**: an entity reached more than once is counted once; walks never loop.
- **Concurrent data changes during an evaluation**: if the graph version changes while an evaluation reads data, it re-reads; if it still changes, the evaluation is completed, flagged as not consistent, and another evaluation is triggered.
- **Overlapping triggers**: at most one evaluation runs at a time, across all application instances.
- **Evaluation failure**: the evaluation is recorded as failed with its error; open risks are left unchanged; the next trigger retries.
- **Rule disabled or entity deleted from scope** (type change, terminal state): its open risks clear at the next evaluation with the reason.
- **Terminal entities** (COMPLETED, CANCELLED): never receive new risks; open ones clear.
- **Auto-created exception fails** (for example the owner team no longer exists): the failure is recorded on the evaluation and the risk, and auto-creation is retried at the next evaluation.
- **Configuration change during an evaluation**: the evaluation keeps the version it started with.
- **Unauthenticated caller**: refused on every new capability. Malformed identifiers and invalid filters are refused with a validation error naming the field. A nonexistent risk, evaluation or SLA term is refused as not found.

## Requirements *(mandatory)*

### Functional Requirements

**SLA terms and clocks**

- **FR-001**: System MUST store **SLA terms** recorded by Administrators against a Contract entity, each with:
  - a code (1 to 32 characters, letters, digits and hyphens, unique per contract ignoring case) and a name (1 to 200 characters);
  - the **clause** text it transcribes (1 to 2,000 characters), so that every clock can show where its rule came from;
  - the governed entity type: **Order** (orders the contract GOVERNS);
  - **start events**: 1 to 5 event types (default `order.created`) with the order as subject;
  - **stop events**: 0 to 5 event types (default `shipment.departed`, `shipment.delivered`) with the order as subject or related entity; reaching COMPLETED also stops the clock;
  - a **window** from 1 minute to 90 days;
  - an **at-risk threshold** from 1% to 99% of the window (default 25%);
  - an active flag, its author, creation time and last change.

  Terms MUST never be deleted; deactivating a term stops its clocks.
- **FR-002**: For every active term, System MUST run one **clock** per governed order:
  - **start** = the earliest start event's time; when none exists, the order's first state observation time, flagged as a **fallback**;
  - **due** = start + window;
  - **stop** = the earliest of: a stop event's time, the first time the order was observed COMPLETED; CANCELLED makes the clock **Cancelled**;
  - **elapsed** = evaluation time − start, and **remaining** = due − evaluation time (negative when overdue), each never computed from a time later than the stop.
- **FR-003**: System MUST also run a clock for every **SLA record** (entity type SLA) that has a due time attribute (`dueBy`): start = its `startAt` attribute when present, otherwise its first observation (fallback); due = `dueBy`; stop = the first time it was observed COMPLETED (CANCELLED: Cancelled). The clock MUST show the source-reported state next to the computed status and state any disagreement in a sentence (AT_RISK disagrees with On track; ACTIVE disagrees with At risk or Breached; COMPLETED disagrees with a running clock).
- **FR-004**: Clock status at an evaluation time T MUST follow these rules, the same as 007's exception SLA rule with the threshold as a parameter:
  - stopped: **Met** if stopped at or before the due time, otherwise **Missed**; cancelled: **Cancelled**;
  - otherwise **Breached** if T is after the due time;
  - otherwise **At risk** if the remaining time is at most the at-risk threshold share of the window;
  - otherwise **On track**.

  Each clock MUST state start (with its source event or fallback), due, elapsed, remaining or overdue time, status and a fixed-template sentence.
- **FR-005**: **Reconciliation with feature 007.** OpsGraph has exactly one SLA status vocabulary (On track, At risk, Breached, Met, Missed, plus Cancelled for commitments) and one at-risk rule, used both by 007's exception **resolution SLA** and by this feature's **SLA commitments**:
  - 007's exception SLA due time remains the deadline for resolving the case. It is labelled "Resolution SLA" wherever both appear on one page, and is never computed from a contract.
  - This feature's clocks are labelled "SLA commitment", come only from contract terms and SLA records, and are never stored on exceptions.
  - When a risk auto-creates an exception (FR-035) from an SLA breach likely risk, the exception's resolution SLA due time is the earlier of 007's default for a High exception and the commitment's due time, when the latter is in the future, so that the case is due no later than the customer commitment.
  - 007's behaviour, windows, threshold (25%) and texts do not change.

**Risk rules**

- **FR-006**: System MUST provide exactly six risk rules, each producing risks of one type:

  | Risk type | Applies to | Evaluated when |
  |---|---|---|
  | SLA breach likely | Orders and SLA records with a running clock | always |
  | Payment unresolved too long | Payments | the payment's state is impaired (006) |
  | Approval delayed | Approvals and Budget requirements | the entity's state is impaired |
  | Supplier disruption | Suppliers | the supplier is impaired, or at least one entity that depends directly on it is impaired |
  | Warehouse capacity pressure | Warehouses | always |
  | High downstream dependency | every type except Customer, Contract and SLA | at least one entity depends directly on it |

  "Impaired" is 006's state class (PENDING, WAITING, BLOCKED, MISSING, DELAYED, FAILED, SUSPENDED, AT_RISK). Terminal entities (COMPLETED, CANCELLED) are never evaluated.
- **FR-007**: Each rule MUST have a fixed list of **factors**. Each factor measures one value of the entity at the evaluation time, from this catalogue:
  - **own state**: whether the entity is impaired;
  - **own unresolved time**: how long the entity has been continuously impaired;
  - **own utilization**: a warehouse's reported utilization percentage;
  - **SLA remaining**: the share of the window left on the entity's most urgent running clock;
  - **longest unresolved dependency**: the longest own unresolved time among impaired entities the entity depends on, within the rule's upstream depth;
  - **warehouse utilization upstream**: the highest reported utilization among warehouses the entity depends on (or itself);
  - **tightest downstream SLA**: the smallest SLA remaining share among running clocks of the entity and of entities that depend on it, within the downstream depth;
  - **currently affected downstream**: the number of impaired entities that depend on it through chains of impaired entities (006's "current"), optionally of given types;
  - **all downstream**: the number of non-terminal entities that depend on it (006's "current" + "potential"), optionally of given types;
  - **directly impaired dependents**: the number of impaired entities that depend on it directly;
  - **recent events**: the number of events of given types linked to it within a given period before the evaluation time.
- **FR-008**: Each factor MUST convert its value into **points** (0 to 100, whole numbers) through ordered **bands** ("at least 4 hours → 80 points"; for SLA remaining "at most 25% → 80 points"). A value that matches no band scores 0. A yes/no factor scores its configured points when yes.
- **FR-009**: The default configuration MUST be the one in contracts § Default configuration: the factors, weights, bands, thresholds (HIGH ≥ 70, MEDIUM ≥ 40, LOW ≥ 20 for every rule), depths (upstream 3, downstream 6) and auto-exception settings (disabled) listed there.

**Scoring, level and confidence**

- **FR-010**: A rule's **score** MUST be the sum over its factors of weight × points, divided by 100 and rounded half up to a whole number from 0 to 100. Weights are whole numbers summing to 100. No other input may change the score.
- **FR-011**: A rule's **level** MUST be HIGH when the score is at least the rule's high threshold, MEDIUM when at least the medium threshold, LOW when at least the low threshold. Below the low threshold, the rule produces no risk.
- **FR-012**: A risk's **confidence** MUST follow these published rules, evaluated in order:
  - **LOW** when, counting only entities reached through source relationships and only clocks attached through source relationships, the level would be lower (including "no risk");
  - **MEDIUM** when the points of any factor would differ under that restriction, or a contributing factor (points above 0) uses a clock start fallback, or reads an entity state on which sources disagree;
  - **HIGH** otherwise.

  Each confidence MUST list its reasons as sentences naming the factor, the entities or clock involved, and the source-only points.
- **FR-013**: Every risk MUST state its type, affected entity, score, level, confidence with reasons, the factors in the rule's fixed order (each with label, value, value sentence, weight, points, contribution, the band applied, the source-only points, and the entities, records, events and clocks behind the value), a headline sentence naming the three highest-contributing factors, the evaluation "as of" time, and the configuration version.
- **FR-014**: Every factor value that comes from data MUST cite its provenance: for state times, the state observation's source system, source id and observation time; for events, the event's source system, source id and time; for clocks, the term (contract, code, author) or SLA record and the start's source; for counts, the counted entities (first 20, with the total).
- **FR-015**: Risk evaluation MUST be **deterministic**: given the same stored graph, the same configuration version, the same active SLA terms and the same evaluation time, it MUST produce identical risks, scores, levels, confidence, factors, sentences and ordering. It MUST NOT use randomness, the clock (except to choose the evaluation time when none is given), or any learned model.

**Evaluations**

- **FR-016**: System MUST run an **evaluation** of all rules:
  - on a schedule, every 5 minutes;
  - after every import that applies changes (trigger "data change"), starting within 30 seconds;
  - after any change of risk configuration or SLA terms (trigger "configuration change");
  - when an Administrator requests it (trigger "manual").

  At most one evaluation MUST run at a time across all application instances. Triggers that arrive during a run MUST cause exactly one further run.
- **FR-017**: Each evaluation MUST record: a sequential number, trigger, actor (System or the requesting Administrator), "as of" time, start and end times, status (Running, Completed, Failed), the graph version it read, the configuration version, a digest of the active SLA terms, whether the graph stayed unchanged while it read, the counts of entities evaluated and risks raised, changed, cleared and open by level, the auto-exception outcomes, and any error.
- **FR-018**: The "as of" time MUST default to the evaluation's start time. An Administrator MAY give one for a manual evaluation; it MUST NOT be earlier than the latest completed evaluation's. Scheduled and data-change evaluations use the later of the current time and the latest completed "as of" time.
- **FR-019**: After each completed evaluation, System MUST update the stored risks:
  - **raise** a new risk (with a new number shown as "RSK-" followed by the number) for each rule result with no open risk of that type for that entity;
  - **change** an open risk whose level, score, confidence, factor points or factor anchors (the start times, due times, counted entities and values behind each factor) differ, recording a new **assessment**;
  - **clear** an open risk whose rule produced no result, with the reason (below threshold, rule disabled, entity terminal or out of scope).

  Unchanged risks MUST NOT be rewritten. At most one open risk MUST exist per type and entity.
- **FR-020**: Assessments MUST be stored unchanged and never edited or deleted. Risks, assessments and evaluations MUST never be deleted.
- **FR-021**: Counts of downstream entities MUST equal the corresponding counts of feature 006's impact analysis of the same entity at the same depth and graph state (current and total per entity type), and MUST state how many of the counted entities are reached only through inferred or manual links.
- **FR-022**: Any signed-in user MUST be able to request a **preview** of all rules for one entity at a given "as of" time with the current or a given configuration version. A preview MUST NOT store anything and MUST return exactly what an evaluation at that time would compute for that entity.

**Configuration**

- **FR-023**: Administrators MUST be able to change, per rule: enabled, the factor weights, the band thresholds and points, the factor parameters (event types and period of the recent-events factor; entity types of count factors, within the rule's applicable types), the three level thresholds, the upstream and downstream depths (1 to 6), and the auto-exception settings (enabled, owner, exception type). They MUST NOT add or remove factors or change what a factor measures.
- **FR-024**: Every saved change MUST create a new, immutable **configuration version** containing all six rules, with its author, time and a required change note (1 to 500 characters). Changes MUST carry the version the Administrator last saw; a change based on an older version MUST be refused as a conflict. Every signed-in user MUST be able to read the current configuration and list past versions.
- **FR-025**: Validation MUST refuse, naming the field: weights not summing to 100 or outside 0 to 100; bands not strictly ordered in the factor's direction, more than 6 bands, or points outside 0 to 100; thresholds not satisfying 1 ≤ low < medium < high ≤ 100; depths outside 1 to 6; event types outside 1 to 100 characters or more than 10; periods outside 1 minute to 30 days; an auto-exception owner that is a deactivated user or unknown team.

**Risks & Alerts area**

- **FR-026**: The **Risks** list MUST show for each risk: number, level, score, confidence, type, affected entity (name, type and state), headline, raised time, last change time, and the auto-created exception if any, with the "as of" time of the latest completed evaluation stated above the list.
- **FR-027**: The list MUST offer filters, combinable: status (Open by default, Cleared, All), level (several), type (several), entity type (several), confidence (several), entity, a raised-since time, and "has auto-created exception".
- **FR-028**: The list MUST offer sorts, each with a fixed tie-break by risk number: **score** (default, highest first, then level), **level** (HIGH first, then score), **newest** (raised time, newest first), **recently changed**. It MUST paginate with a default page size of 50 and a maximum of 200, state the total, and keep the filters and sort in the page address.
- **FR-029**: The **risk page** MUST show everything in FR-013, the assessment history (oldest first, each with its "as of" time, evaluation number, level, score, confidence and the factors that changed), the clearance if any, links to the entity's Entity 360 page, its impact section, the entities named in the factors, the unresolved exceptions linked to the entity (007), the auto-created exception, and a **Preview now** action that shows the live result of FR-022 next to the stored one.
- **FR-030**: The **Alerts** tab MUST list risk raises, level changes and clearances of a chosen period (default the last 7 days, at most 90), newest first, with time, risk number, entity, type and before and after level and score, paginated.
- **FR-031**: The **SLA commitments** tab MUST list clocks computed at a stated "as of" time, filterable by status (several), contract, term and entity, sorted most urgent first (Breached by most overdue, then At risk and On track by least remaining share, then Met, Missed, Cancelled), with a fixed tie-break by entity, paginated.
- **FR-032**: Risk and SLA pages MUST present text, tables and lists. This feature MUST NOT add a graph view.

**Entity 360 integration**

- **FR-033**: Every Entity 360 page MUST show the entity's highest open risk level in its header (when it has one) and a **Risk & SLA** section after Impact and before Exceptions with the content of Story 5. Contract pages list their SLA terms with clock counts per status. Failure to load the section MUST NOT blank the page.

**Automatic exceptions**

- **FR-034**: Auto-creation MUST be configurable per rule (disabled by default), with an optional owner (a user or team) and an exception type, defaulting to: SLA breach likely → SLA risk; Payment unresolved too long → Failed payment; Approval delayed → Missing approval; Supplier disruption → Shipment delay; Warehouse capacity pressure → Shipment delay; High downstream dependency → Blocked order.
- **FR-035**: After an evaluation completes, for each open HIGH risk of a rule with auto-creation enabled and no auto-created exception, System MUST create an exception through feature 007's creation rules, as the System actor, unless the entity is linked in any role to an unresolved exception (recorded as skipped). At most 20 MUST be created per evaluation, highest score first, then risk number; the rest are deferred to the next evaluation. A failure MUST be recorded and retried at the next evaluation.
- **FR-036**: An auto-created exception MUST have: subject the risk's entity; severity High; priority and SLA due time from 007's defaults, except FR-005's rule for SLA breach likely; the configured type and owner; the title "<entity name>: <risk type label> (<risk number>)" (cut to 200 characters); a description containing the risk's headline, level, score, confidence and factor sentences; creation origin **From risk**. Its 007 creation audit record MUST name the risk, and the risk MUST record the exception in an audited change.

**Permissions, audit and access**

- **FR-037**: Permissions:

  | Action | Allowed for |
  |---|---|
  | View risks, risk pages, assessments, alerts, evaluations, SLA terms, SLA clocks, configuration and its versions; preview | every signed-in user |
  | Create, change, activate or deactivate SLA terms | Administrators |
  | Change risk configuration | Administrators |
  | Request a manual evaluation | Administrators |

  A refused action MUST change nothing and MUST be audited as a refusal.
- **FR-038**: Every mutation MUST write an audit record, atomically with the change, with actor, action, target, time, and before and after values: SLA term created or changed; configuration initialized or changed (the changed rule before and after, and the note); each evaluation completed or failed (System or the requesting Administrator); each risk raised, rescored, changed level or cleared (System, naming the evaluation); each risk's auto-created exception recorded (System). Unchanged risks MUST NOT write audit records.
- **FR-039**: Unauthenticated callers MUST be refused on every new capability. Every new request and response payload MUST be defined once as a shared, validated schema used by the backend and the web app. Every new endpoint MUST have end-to-end tests for its success path, authentication failure, validation failure and, where it applies, permission refusal, not found and conflict.

**Seed and tests**

- **FR-040**: The seed MUST add, idempotently: risk configuration version 1 (the defaults, by System), and the reference SLA term **SHIP-24H "Ship within 24 hours of order"** on Contract CON-3982 (orders; start `order.created`; stop `shipment.departed`, `shipment.delivered`; window 24 hours; threshold 25%; clause "Orders must ship within 24 hours of being placed."), authored by System. The §39 and §40 datasets and the 007 and 008 seed rows MUST remain unchanged. The seed MUST NOT run an evaluation.
- **FR-041**: Automated tests MUST cover at least:
  - each clock rule of FR-002 to FR-004 at its boundaries (at the at-risk boundary, 1 ms before, at the due time, 1 ms after), fallback starts, stop events, COMPLETED, CANCELLED and source disagreement;
  - each factor measure, each band direction, the score rounding, each level threshold and each confidence rule;
  - fixtures K1 to K10 on the seeded scenarios at the published evaluation times;
  - determinism: repeated previews and evaluations at the same time give identical output;
  - equality of downstream counts with 006 (FR-021) on both seeded scenarios;
  - raise, change, clear and re-raise; assessment and audit writing only on material changes;
  - single-run scheduling, coalescing of triggers and the monotonic "as of" rule;
  - configuration validation, versioning and conflicts; SLA term validation;
  - auto-creation: success, once per risk, skip when already linked, cap, failure and retry, FR-005's due time;
  - every row of the permission table.

### Key Entities

- **SLA Term**: a contract's service commitment as recorded by an Administrator: contract, code, name, clause, governed type, start and stop events, window, at-risk threshold, active flag, author.
- **SLA Clock**: the computed state of one term for one governed order, or of one source SLA record, at an evaluation time: start (with source or fallback), due, stop, elapsed, remaining, status, sentence. Computed, not stored.
- **Risk Configuration Version**: an immutable, complete set of the six rules' settings, with author, time and note.
- **Risk Rule**: one of six fixed rules: applicability, factors, weights, bands, thresholds, depths, auto-exception setting.
- **Risk Evaluation**: one run of all rules at an "as of" time, with trigger, actor, versions read, counts and outcome.
- **Risk**: one episode of one rule's result for one entity, from raise to clearance: number, type, entity, status, current level, score and confidence, peak level, raise and clearance, auto-created exception.
- **Risk Assessment**: an immutable record of a risk's full result at one evaluation: score, level, confidence with reasons, factors with values, points and evidence.
- **Risk Factor**: one measured value of a rule for an entity, with its weight, points, band and provenance (part of an assessment).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 100% of risks, a reader can recompute the score from the factors shown on the risk page, and every factor value names its source records, events, clocks or counted entities.
- **SC-002**: 100 consecutive previews, and two evaluations, of the seeded scenarios at the same "as of" time with unchanged data and configuration produce byte-identical results.
- **SC-003**: Risks reflect imported data within 1 minute of an import completing, and never lag more than 6 minutes behind the clock while the application runs.
- **SC-004**: On a graph of 50,000 entities and at least 150,000 relationships, a full evaluation completes in under 2 minutes; the first page of the Risks list (10,000 open risks, any filter and sort) loads in under 1 second at the 95th percentile over 20 runs; an entity's Risk & SLA section and a preview load in under 2 seconds.
- **SC-005**: Starting from the Risks & Alerts list, a user reaches the affected entity's Entity 360 page and its impact analysis in at most two selections from any risk row.
- **SC-006**: After seeding and an evaluation as of 2026-09-30T03:12:00Z, the reference risks match fixtures K1 to K5 exactly: Order #18492 SLA breach likely HIGH 73 with "6h remaining" and "Payment PAY-88213 unresolved for 17h 7m", matching Product Overview §14 and §36.
- **SC-007**: 100% of configuration changes, SLA term changes, risk raises, level changes, clearances and auto-created exceptions appear in the audit trail with before and after values, and 0 audit records are written for unchanged risks.
- **SC-008**: With auto-creation enabled, 0 duplicate exceptions are created for the same risk across 10 consecutive evaluations.

## Assumptions

- **Scope boundaries**: out of scope, for later features:
  - machine learning, statistical baselines, anomaly or "abnormal processing time" detection, growing backlog, recurring failure frequency (§31, §32), customer concentration, customer importance and financial exposure as risk factors (§14, §15 list them; they need customer tiers and currency rules not in the MVP data);
  - recommended actions on risks (§33, §50), what-if analysis (§13), workflows (§17);
  - email, chat or in-app notifications about risks themselves (the Alerts tab and 007's assignment notification for auto-created exceptions cover the MVP);
  - acknowledging, snoozing or dismissing risks; risks are system-managed and clear only when their rule stops producing them;
  - business-hours calendars, holiday calendars and pausing SLA clocks;
  - SLA terms governing types other than Order (shipments, invoices), and importing machine-readable SLA terms from contract source records.
- **SLA terms are transcribed by Administrators** (in place of a clarification on where SLA rules come from): the MVP's contract records carry clause text only (002 seed), so an Administrator records each term against its contract, quoting the clause. The term is configuration with its author and time as provenance, shown on every clock; it does not lower risk confidence. Source-reported SLA records with a due time are tracked as well (FR-003).
- **Governed orders**: a term applies to the orders its contract GOVERNS. A clock attached through an inferred or manual GOVERNS link counts as non-source support for confidence (FR-012).
- **Clock start fallback**: when no start event exists, the first observation of the order is used and flagged; for source SLA records without `startAt`, the first observation is used and flagged. Both lower confidence to MEDIUM when the clock contributes points.
- **"As of" semantics** (in place of a clarification on how evaluation time interacts with history): like 005's evaluation time, the "as of" time drives time arithmetic only; the graph is read as currently stored, identified by its graph version (the newest source record), so "same graph state + same time → same scores" is testable. Historical replay of past graph states is out of scope.
- **Risk episodes**: a risk is one continuous period during which its rule produces a result for the entity. After clearance, a recurrence is a new risk with a new number; this makes "one auto-created exception per risk" well defined.
- **Scores are coarse by design**: factors score in bands, so a score changes only when a band boundary is crossed or data changes. This keeps scores explainable (§15) and keeps the assessment history and audit trail free of five-minute noise.
- **Default thresholds**: HIGH ≥ 70, MEDIUM ≥ 40, LOW ≥ 20 for every rule, and the default weights and bands in contracts, are reasonable starting points for the Logistics/Commerce vertical, tuned so that the §14/§36 reference order is HIGH six hours before its 24-hour commitment. Administrators tune them (Story 4).
- **Auto-created exception types**: 007 has no "payment delay" type, so Payment unresolved too long defaults to "Failed payment"; Administrators can choose another type per rule. Auto-created exceptions have severity High because they come from HIGH risks.
- **Duplicate protection**: an entity already linked to an unresolved exception never gets an auto-created exception, so the §16 reference exception (which links Shipment SHP-77120 and Budget code for Order #18492) prevents duplicates for those entities.
- **Reference evaluation times**: fixtures use 2026-09-29T16:00:00Z (005's pinned time), 2026-09-30T03:12:00Z (six hours before Order #18492's 24-hour commitment) for §39, and 2026-10-05T16:00:00Z for §40.
- **Dependencies**: features 005 (state words, evaluation time pattern), 006 (impaired state class, downstream direction and counts), 007 (exception creation, SLA rule, teams, owner references, notifications) and 008 (Entity 360 section order) are reused. 006 and 007 must be implemented before this feature; 005 and 008 must be merged so the Entity 360 order and shared modules are final.
- **Existing foundation**: sign-in, roles, users, audit, the error format, shared schemas, the entity model, imports, the reference seeds and the Entity 360 page come from features 001 to 008 and are reused.
