# Feature Specification: Core Operational Graph Model

**Feature Branch**: `002-operational-graph-model`
**Created**: 2026-10-05
**Status**: Draft
**Input**: User description: "Core operational graph model for the Logistics/Commerce vertical. Store Entities (types: Customer, Contract, Order, Product, Payment, Invoice, Approval, Warehouse, Shipment, Supplier, SLA, BudgetRequirement), typed Relationships (e.g. PLACED, GOVERNS, REQUIRES, BLOCKS, FULFILLED_BY, SUPPLIED_BY, DEFINES, DEPENDS_ON) with origin SOURCE/INFERRED/MANUAL and confidence HIGH/MEDIUM/LOW, Events (timestamped, linked to entities), current State per entity, and SourceRecords (raw payload + source system + source id + observed_at) so every entity/relationship/state/event is traceable to its source. Provide JSON/CSV import of entities, relationships and events through an authenticated admin endpoint (audited, with per-row validation errors and no silent data loss). Seed the Product Overview §39 scenario (Acme Corp, Contract CON-3982, Order #18492 $12,480, Payment, Finance Approval, missing Budget Code, Warehouse, Shipment, SLA) plus enough extra orders/customers (≈17 orders, 4 customers) to make impact meaningful. Include a basic entity list and entity detail page (identity, source systems, current state, raw source records, relationships, timeline). Graph traversal is NOT in scope yet, but create the GraphRepository interface with neighbor lookup only. Identity resolution and source-conflict detection are out of scope, but the model must allow multiple SourceRecords per entity."

## Overview

This feature gives OpsGraph its operational memory: the entities of the Logistics/Commerce vertical, the typed relationships between them, the events that happened to them, and their current state. Every one of these facts stays traceable to the source record it came from.

It delivers:

- the graph data model (entities, relationships, events, state, source records), with provenance on every fact
- an administrator-only import of entities, relationships and events from JSON or CSV, with per-row validation and a full accounting of every row
- a seeded reference scenario reproducing Product Overview §39 (Acme Corp / Order #18492) plus enough surrounding orders and customers for later impact analysis to be meaningful
- an entity list and an entity detail page, so a user can inspect any entity's identity, sources, state, raw records, relationships and timeline
- a single, central capability for reading an entity's direct (one-hop) neighbors, which later tracing and impact features will build on

It does **not** deliver multi-hop traversal, root cause, impact, risk, identity resolution, conflict detection or a graph visualization. Those are later features that depend on this one.

## Clarifications

### Session 2026-10-05

- Q: Must refused import attempts by unauthenticated callers be audited? → A: No. Unauthenticated requests are refused with 401 and, as everywhere in feature 001, are not audited. Only forbidden attempts by signed-in non-Administrators are audited (FR-025, SC-006).
- Q: When an import contains invalid rows, should the valid rows be committed (partial) or nothing committed (all-or-nothing)? → A: All-or-nothing. Any rejected row means nothing from that import is stored. The report still lists every rejected row, and the attempt is recorded and audited (FR-027, FR-028, FR-032).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inspect an entity and see where every fact came from (Priority: P1)

An operations user (Administrator, Operations Manager or Operations Analyst) opens the entity list, filters it to Orders, and finds Order #18492. On its detail page they see:

- **Identity**: type, name, identifiers in each source system.
- **Current state**: BLOCKED, with the source system that reported it and when.
- **Raw source records**: each with its source system, source identifier, observation time, and original payload.
- **Relationships**: incoming and outgoing, each showing the related entity, the relationship type, whether it is a sourced fact, an inference or a manual entry, and its confidence.
- **Timeline**: the chronological events that led here.

From any related entity, they can navigate to that entity's own detail page.

**Why this priority**: Every later capability (tracing, root cause, impact, investigations) presents conclusions that must be backed by inspectable entities and source records. This is the first time users can see operational data in OpsGraph at all.

**Independent Test**: Seed the reference scenario. Sign in as an Analyst, open Order #18492 from the list, and confirm every section shows the expected data. Confirm every displayed relationship shows its origin and confidence. Confirm each state, relationship and event can be traced to a named source system, source identifier and observation time.

**Acceptance Scenarios**:

1. **Given** the seeded data, **When** a signed-in user opens the entity list, **Then** they see entities with type, name, primary identifier, current state, source systems and last-observed time, paginated, and can filter by entity type, current state and source system, and search by name or identifier.
2. **Given** the seeded data, **When** the user opens Order #18492, **Then** its current state is BLOCKED, its value is 12,480.00 USD, and it lists at least the relationships to Acme Corp, Contract CON-3982, its Payment, its Warehouse and its Shipment.
3. **Given** an entity that has records from two source systems, **When** its detail page is opened, **Then** both source systems and both raw records are shown, each with its own source identifier, observation time and original payload.
4. **Given** a relationship whose origin is INFERRED or MANUAL, **When** it is displayed anywhere, **Then** it is visibly labeled as inferred or manual with its confidence, and never looks the same as a sourced fact.
5. **Given** the detail page of an entity with events, **When** the timeline is shown, **Then** events and state changes appear in chronological order of when they occurred, each with its source system, and state changes are visually distinguishable from events.
6. **Given** a user who is not signed in, **When** they request the entity list or an entity's details, **Then** access is refused.

---

### User Story 2 - The §39 reference scenario is ready out of the box (Priority: P1)

A contributor or demo operator sets up a fresh environment with the documented setup steps. The data store then already contains the Product Overview §39 scenario:

- Acme Corp, under Contract CON-3982, placed Order #18492 for $12,480.
- The order's Payment needs Finance Approval.
- That approval is stuck because a required Budget Code is missing.
- The Warehouse has not started fulfillment.
- The Shipment is delayed, and the customer's SLA is at risk.

Around it sit enough other customers, orders, shipments and SLAs that later impact analysis can report the §39 headline figures: 17 orders affected, 4 customers affected, 3 SLA risks, $31,400 revenue exposure.

**Why this priority**: The reference scenario is the shared acceptance fixture for every later feature (dependency tracing, root cause, impact, investigations). Without it, those features have nothing deterministic to be tested against. The project rules also require the seed to contain it.

**Independent Test**: Run the documented setup on an empty data store. Then check the stored data for exactly the entities, states, relationships, events and totals listed in FR-035 to FR-042. Run setup a second time and confirm no duplicates appear.

**Acceptance Scenarios**:

1. **Given** an empty data store, **When** the documented setup is run, **Then** the scenario entities exist with the states listed in FR-036 and the relationships listed in FR-037.
2. **Given** the seeded data, **When** a user opens the Budget Requirement, **Then** its state is MISSING, and the Finance Approval that requires it is BLOCKED.
3. **Given** the seeded data, **When** the orders that depend, directly or transitively, on the missing Budget Requirement are counted, **Then** there are exactly 17, they belong to exactly 4 customers, their total value is exactly 31,400.00 USD, and exactly 3 of those customers' SLAs are AT_RISK.
4. **Given** the seeded data, **When** any seeded entity, relationship, state or event is inspected, **Then** it has a source system, source identifier and observation time, like imported data.
5. **Given** setup has already run, **When** it is run again, **Then** the data is unchanged and nothing is duplicated.

---

### User Story 3 - Administrator imports operational data from JSON or CSV (Priority: P2)

An Administrator has an export from a source system: a JSON document, or CSV files for entities, relationships or events. They submit it to OpsGraph's import. They can first run it as a dry run, which validates it without changing anything.

The import returns a report that accounts for every submitted row. Each row is either created, updated, unchanged or rejected, and each rejected row has its row number, the field at fault and a reason. Nothing submitted is silently dropped or altered. Fields OpsGraph does not recognize are kept in the raw source record rather than discarded.

**Why this priority**: Import is how real operational data gets into the graph. The seed proves the model, but import makes it usable beyond the demo. It is P2 because the P1 stories can be demonstrated on seed data alone.

**Independent Test**: As an Administrator, submit a JSON file with 5 valid entities, 3 valid relationships, 2 valid events, 1 entity with an unknown type, and 1 relationship pointing to a nonexistent entity. Check the report against FR-028 and FR-029, and confirm that nothing was stored. Remove the 2 invalid rows, resubmit, and confirm the 10 valid rows are stored. Repeat with the same content as CSV files. Confirm that an Analyst or Operations Manager is refused.

**Acceptance Scenarios**:

1. **Given** a valid JSON import containing entities, relationships and events, **When** an Administrator submits it, **Then** all rows are stored with their provenance, and the report counts them as created.
2. **Given** an import in which some rows are invalid, **When** it is submitted, **Then** the report lists every invalid row with its row number (or position), the offending field, and a human-readable reason. The import is marked as rejected, and nothing from it is stored, including its valid rows (FR-027).
3. **Given** a dry run, **When** it is submitted, **Then** the same report is produced as a real import would produce, and nothing is stored or audited as a data change.
4. **Given** a row containing fields OpsGraph does not recognize, **When** it is imported, **Then** the row is accepted (if otherwise valid) and the unrecognized fields are preserved unchanged in the stored raw source record.
5. **Given** a relationship row that refers to an entity created earlier in the same import, **When** the import is processed, **Then** the relationship is linked correctly, regardless of where the entity appears in the file.
6. **Given** an Operations Manager or Operations Analyst, **When** they attempt an import by any means, **Then** it is refused as forbidden, and the attempt is audited.
7. **Given** a successful (non-dry-run) import, **When** an Administrator opens the audit trail, **Then** they find one entry summarizing the import (actor, format, row counts) and one entry per created or changed entity, relationship or event. Each per-row entry carries its before and after values and is linked to the import.

---

### User Story 4 - Entities accumulate observations from several systems over time (Priority: P2)

The same Order is reported by the Order Management System and by the ERP. Over the day, the Order Management System sends updated states (CREATED, then PENDING, then BLOCKED).

OpsGraph keeps every observation as its own source record. The current state is always the latest observation by observation time, and the earlier observations remain visible as state history. A second source system's record is attached to an existing entity only when the import explicitly says which entity it describes. OpsGraph never guesses that two records are the same thing.

**Why this priority**: Without multiple source records per entity and a preserved history, provenance and future conflict detection are impossible. This is a model requirement more than a UI flow, so it is P2.

**Independent Test**: Import an Order from system A. Import a record from system B that explicitly references that Order. Import a newer state for the Order from system A, then an older one. Check the results against FR-019 to FR-022.

**Acceptance Scenarios**:

1. **Given** an existing entity from system A, **When** an import row from system B explicitly references that entity, **Then** the new source record is attached to the same entity, and the entity now lists both source systems.
2. **Given** an existing entity from system A, **When** an import row from system B describes an entity of the same type and name but does **not** reference the existing entity, **Then** a separate entity is created. No automatic matching occurs.
3. **Given** an entity whose current state was observed at 10:00, **When** a state observed at 09:00 is imported, **Then** it is stored in the state history, but the current state does not change.
4. **Given** an import that re-submits a record identical to one already stored (same source system, source identifier, observation time and payload), **When** it is processed, **Then** the report marks it as unchanged, and no duplicate is stored or audited.
5. **Given** two source systems whose latest reported states for one entity differ, **When** the detail page is opened, **Then** each source system's latest reported state is shown alongside the overall current state. Neither value is hidden.

### Edge Cases

- **Row references an unknown entity**: a relationship or event pointing to an entity that does not exist, or to an entity whose row was rejected in the same import, is rejected with a reason naming the missing reference. Placeholder entities are never created.
- **Disallowed relationship**: a relationship between entity types not permitted for its relationship type (see FR-009) is rejected, for example `Supplier PLACED Order`.
- **Self-relationship**: a relationship from an entity to itself is rejected.
- **Cycles**: relationship cycles across different entities (A→B→A) are accepted and stored, because real operations contain them. Handling them is the responsibility of the later traversal feature.
- **Duplicate identifier in one import**: two entity rows in the same import with the same source system, source identifier and observation time but different content are both rejected as ambiguous, with each row named in the report.
- **Ambiguous or invalid timestamps**: timestamps without a timezone, unparseable dates and observation times more than 5 minutes in the future are rejected.
- **Invalid money**: negative or non-numeric amounts, and currencies that are not valid 3-letter codes, are rejected.
- **Unsupported value**: an unknown entity type, relationship type, origin, confidence or state value is rejected, and the report lists the allowed values.
- **Missing justification**: an INFERRED or MANUAL relationship without a stated basis (see FR-012) is rejected.
- **File too large**: an import over the limit in FR-034 is refused as a whole before any row is processed, with a message stating the limit.
- **Malformed file**: invalid JSON, a CSV without a header row, a CSV with a wrong column count on some rows, or a file that is not UTF-8 is reported precisely: a file-level error for an unreadable file, or row-level errors where specific rows are malformed.
- **Concurrent imports touching the same entity**: the outcome depends only on observation times, never on which import finished first. Both imports are fully audited.
- **Entity with very many relationships or events**: the detail page paginates relationships and timeline entries and stays responsive (see SC-003).
- **Entity type with no records**: filtering the list to that type shows an empty state, not an error.
- **Removed from source**: if a source system no longer contains a record, nothing happens in this feature. Imports never delete entities.

## Requirements *(mandatory)*

### Functional Requirements

**Entities**

- **FR-001**: System MUST support exactly these entity types in this feature: Customer, Contract, Order, Product, Payment, Invoice, Approval, Warehouse, Shipment, Supplier, SLA, BudgetRequirement.
- **FR-002**: Each entity MUST have a unique OpsGraph identifier, a type, a display name (for example "Order #18492"), one or more source records, a current state, and a set of descriptive attributes. Attributes are type-specific values such as amount and currency for an Order, or due-by time for an SLA.
- **FR-003**: Monetary attributes MUST be stored as an exact decimal amount with an ISO 4217 currency code, never as a floating-point approximation.

**Source records & provenance**

- **FR-004**: Every source record MUST store the source system name, the identifier of the record in that system, the observation time (when OpsGraph's source observed it), the time OpsGraph received it, the raw payload exactly as received, and the import (or seed run) that delivered it.
- **FR-005**: An entity MUST be able to have any number of source records, from one or more source systems, including several observations over time of the same source record.
- **FR-006**: Every relationship, state observation and event MUST likewise record its source system, source identifier, observation time, and the import or seed run that delivered it. Normalization MUST NOT discard source-specific fields: anything in the received row that is not mapped to a known field MUST remain retrievable in the raw payload.

**Relationships**

- **FR-007**: System MUST support exactly these relationship types in this feature: HAS, PLACED, GOVERNS, CONTAINS, GENERATES, REQUIRES, DEPENDS_ON, BLOCKS, FULFILLED_BY, SUPPLIED_BY, DEFINES, RELATES_TO.
- **FR-008**: Relationships MUST be directed (from entity → to entity) and carry these meanings:
  - "A REQUIRES B" and "A DEPENDS_ON B" mean A cannot progress or complete without B.
  - "A BLOCKS B" means A is currently preventing B from progressing.
  - "A RELATES_TO B" records a link with no dependency meaning.
  - All other types are descriptive links with the meaning in their name.
- **FR-009**: System MUST reject relationships whose entity types are not permitted for their relationship type:

  | Relationship type | Allowed "from" type(s) | Allowed "to" type(s) |
  |---|---|---|
  | HAS | Customer | Contract |
  | PLACED | Customer | Order |
  | GOVERNS | Contract | Order |
  | CONTAINS | Order | Product |
  | GENERATES | Order | Invoice |
  | FULFILLED_BY | Order, Shipment | Warehouse |
  | SUPPLIED_BY | Product | Supplier |
  | DEFINES | Contract | SLA, BudgetRequirement |
  | REQUIRES, DEPENDS_ON, BLOCKS, RELATES_TO | any | any |

  Self-relationships are rejected for every type.
- **FR-010**: Every relationship MUST carry an origin (SOURCE, INFERRED or MANUAL) and a confidence (HIGH, MEDIUM or LOW).
- **FR-011**: Origin and confidence MUST be returned by every interface that returns relationships. The web interface MUST visually distinguish INFERRED and MANUAL relationships from SOURCE relationships wherever they appear.
- **FR-012**: INFERRED and MANUAL relationships MUST include a basis: a short text explaining why the link is believed to exist, or who asserted it. Rows without one are rejected.
- **FR-013**: The same relationship (same from entity, type and to entity) MAY be asserted by several sources. Each assertion MUST be kept with its own provenance, origin and confidence. None is merged away.

**State**

- **FR-014**: Each state observation MUST hold a normalized operational state from this set: ACTIVE, PENDING, WAITING, BLOCKED, MISSING, DELAYED, AT_RISK, COMPLETED, FAILED, CANCELLED, SUSPENDED, UNKNOWN. It MAY also hold the source system's own status value, which MUST be preserved verbatim when supplied.
- **FR-015**: An entity's current state MUST be its state observation with the latest observation time. Ties MUST be broken deterministically (the most recently received wins). An entity with no state observation has current state UNKNOWN.
- **FR-016**: All state observations MUST be retained as state history. A new observation MUST never overwrite or delete an earlier one.
- **FR-017**: When an entity's source systems disagree on its latest state, the detail page MUST show each source system's latest state alongside the current state. Formal conflict detection and flagging are out of scope (see Assumptions).

**Events**

- **FR-018**: Each event MUST have:
  - an event type (a lowercase dotted name, for example `order.created` or `approval.requested`)
  - the time it occurred, and the time it was observed
  - exactly one subject entity, plus zero or more related entities
  - an optional description
  - provenance as in FR-006

**Identity & re-import**

- **FR-019**: An entity row MUST be matched to an existing entity only when one of these holds:
  - it has the same entity type, source system and source identifier as an existing source record;
  - it explicitly references an existing entity, by OpsGraph identifier or by a (source system, source identifier) pair already attached to that entity.

  Otherwise, a new entity MUST be created. The system MUST NOT match entities by name or any other heuristic.
- **FR-020**: A row identical to an already-stored record (same source system, source identifier, observation time and content) MUST be reported as unchanged and MUST NOT create a duplicate record or an audit entry.
- **FR-021**: A row for an existing source record with a newer observation time MUST be stored as a new observation. The entity's display name, attributes and current state MUST then reflect the latest observation, and all earlier observations MUST remain retrievable.
- **FR-022**: A row with an older observation time than the latest stored for that source record MUST be stored as history and MUST NOT change the entity's current values.

**Import**

- **FR-023**: Administrators MUST be able to import entities, relationships and events in two forms: a single JSON document containing any combination of the three, or a CSV file containing one of the three kinds (declared by the administrator when submitting).
- **FR-024**: The import format MUST be documented. The documentation MUST include an example file for each kind, the required and optional fields, the allowed values for each enumerated field, and how references to other entities are written.
- **FR-025**: Only Administrators MAY import. All other callers MUST be refused: unauthenticated callers as unauthenticated, and signed-in non-Administrators as forbidden. Every forbidden attempt MUST be audited, as for every other protected operation in feature 001.
- **FR-026**: Within one import, entities MUST be processed before relationships and events, so references to entities defined anywhere in the same import resolve, whatever their order in the file.
- **FR-027**: When an import contains invalid rows, the import MUST be all-or-nothing: the system MUST validate every row first, and if any row is rejected, MUST store nothing and write no data-change audit entries. The report still lists every rejected row, and the import record (FR-031) still records the attempt. Rows that depend on a rejected row (for example, a relationship to a rejected entity) MUST themselves be rejected, with a reason naming the row they depend on.
- **FR-028**: Every import MUST produce a report that accounts for 100% of submitted rows: for each kind, the number received, created, updated, unchanged and rejected, where received = created + updated + unchanged + rejected. Every report MUST also state an overall outcome: APPLIED, REJECTED (at least one row was rejected, so nothing was stored) or DRY_RUN. For REJECTED and DRY_RUN reports, the created, updated and unchanged counts describe what would have happened, and the report MUST label them that way.
- **FR-029**: For each rejected row, the report MUST give the row number (CSV) or position (JSON), the field or fields at fault, and a human-readable reason.
- **FR-030**: Administrators MUST be able to run any import as a dry run. A dry run produces the same report as a real import but stores no data and writes no data-change audit entries.
- **FR-031**: System MUST keep a record of each import: who submitted it, when, format, dry-run flag, overall outcome, row counts, and the per-row rejection details. Administrators MUST be able to retrieve that record afterward.
- **FR-032**: Each import (including a dry run and a rejected import) MUST write one summary audit entry. Each applied import MUST also write one audit entry per created or changed entity, relationship, state observation and event, with before and after values and a link to the import. Stored data and its audit entries MUST succeed or fail together, as defined in feature 001.
- **FR-033**: A JSON import MUST NOT have an unrecognized top-level section silently ignored: it MUST be reported as a file-level error. Unrecognized fields inside a row MUST be preserved in the raw payload (FR-006).
- **FR-034**: A single import MUST be limited to 10 MB and 10,000 rows. Larger submissions MUST be refused as a whole, before any processing, with a message stating the limits.

**Reference seed scenario**

- **FR-035**: The documented setup MUST seed the Product Overview §39 scenario and its surrounding data. All seeded records MUST satisfy the same validation and provenance rules as imported data, using plausible named source systems, for example CRM, Contract Management, Order Management, Payments, Finance Approvals, WMS (warehouse), TMS (transport).
- **FR-036**: The seed MUST contain these §39 entities with these current states:

  | Entity | Type | Key details | Current state |
  |---|---|---|---|
  | Acme Corp | Customer | | ACTIVE |
  | CON-3982 | Contract | Requires finance approval for orders above 10,000.00 USD | ACTIVE |
  | Order #18492 | Order | 12,480.00 USD | BLOCKED |
  | Order #18492's payment | Payment | | PENDING |
  | Finance Approval for that payment | Approval | | BLOCKED |
  | Budget Code requirement | BudgetRequirement | | MISSING |
  | Warehouse that will fulfill the order | Warehouse | | ACTIVE |
  | Shipment for the order | Shipment | | DELAYED |
  | Acme Corp's delivery SLA | SLA | | AT_RISK |

  It MUST also contain an Invoice generated by the order, at least one Product the order contains, and that Product's Supplier.
- **FR-037**: The seed MUST link the §39 entities with at least these relationships, so the blocking chain from the Shipment to the missing Budget Code can be followed by later features:
  - Acme Corp HAS CON-3982
  - Acme Corp PLACED Order #18492
  - CON-3982 GOVERNS Order #18492
  - CON-3982 DEFINES the SLA
  - Order #18492 REQUIRES the Payment
  - the Payment REQUIRES the Finance Approval
  - the Finance Approval REQUIRES the Budget Requirement
  - the Shipment DEPENDS_ON Order #18492
  - Order #18492 FULFILLED_BY the Warehouse
  - the Shipment FULFILLED_BY the Warehouse
  - the SLA DEPENDS_ON the Shipment
- **FR-038**: The seed MUST include a timeline of events for the §39 chain, in this order: order created, payment initiated, approval requested, approval blocked for missing budget code, finance notified, warehouse fulfillment on hold, shipment delayed, SLA at risk. Events MUST use fixed timestamps so the seed is reproducible.
- **FR-039**: The seed MUST make the §39 impact figures reproducible. Exactly 17 orders MUST depend, directly or transitively through REQUIRES, DEPENDS_ON or BLOCKS relationships, on the missing Budget Requirement:
  - Order #18492, through its Payment and Finance Approval
  - 16 other orders that ship on the §39 Shipment. That Shipment is consolidated and cannot leave until Order #18492 is released.

  Those 17 orders MUST:
  - belong to exactly 4 customers (Acme Corp and 3 others), each with its own contract and SLA
  - total exactly 31,400.00 USD
  - be such that exactly 3 of the 4 customers' SLAs are AT_RISK
- **FR-040**: The seed MUST also include at least 3 orders that are healthy and do not depend on the missing Budget Requirement through any REQUIRES, DEPENDS_ON or BLOCKS path, so later impact results can be checked for false positives.
- **FR-041**: The seed MUST include:
  - at least one entity with source records from two different source systems
  - at least one entity with at least three state observations over time
  - at least one INFERRED relationship and at least one MANUAL relationship
  - at least one relationship at each confidence level (HIGH, MEDIUM, LOW)
- **FR-042**: Running the seed again on an already-seeded data store MUST NOT duplicate or alter data.

**Viewing**

- **FR-043**: All signed-in roles (Administrator, Operations Manager, Operations Analyst) MUST be able to view the entity list and entity details. Viewing MUST NOT modify data.
- **FR-044**: The entity list MUST show, per entity: type, display name, primary identifier, current state, source systems and last-observed time. It MUST support filtering by entity type, current state and source system, text search on display name and source identifiers, deterministic ordering, and pagination.
- **FR-045**: The entity detail page MUST contain these sections:
  - **Identity**: type, display name, OpsGraph identifier, each source system with its source identifier, and attributes.
  - **Current state**: the current state, with its source and observation time, each source system's latest state (FR-017), and the state history.
  - **Source records**: each raw source record with its system, identifier, observation and received times, delivering import, and its full raw payload viewable as received.
  - **Relationships**: outgoing and incoming, grouped by relationship type. Each row shows the related entity (linked to its detail page), origin, confidence, basis (where present), source and observation time.
  - **Timeline**: events where the entity is the subject or a related entity, together with its state changes, in chronological order by occurrence time, each with its source.
- **FR-046**: Relationship and timeline sections MUST paginate, so that an entity with thousands of relationships or events stays usable.

**Neighbor lookup**

- **FR-047**: System MUST provide one central graph-reading capability that returns an entity's direct neighbors (exactly one hop). It MUST be filterable by direction (outgoing, incoming, both), relationship type and neighbor entity type. It MUST return, for each neighbor, the relationship with its origin, confidence and provenance. Results MUST be in deterministic order and paginated.
- **FR-048**: The entity detail page's relationship section MUST obtain its data through the capability in FR-047. Any reading of graph connections MUST go through that capability. Multi-hop traversal is out of scope for this feature and MUST NOT be implemented.

**Shared contracts**

- **FR-049**: Every new request and response payload MUST be defined once as a shared, validated schema used by both the backend and the web app. Every new endpoint MUST have at least one end-to-end test covering its success path and its authorization failure, following the conventions established in feature 001.

### Key Entities

- **Entity**: an operationally meaningful thing (one of the 12 types in FR-001). It has an OpsGraph identifier, display name, attributes and a current state. It is backed by one or more Source Records, and connected to other entities by Relationships.
- **Source Record**: one observation of one record in one external system: source system, source identifier, observation time, received time, raw payload, and delivering import. An entity can have many, across systems and over time.
- **Relationship**: a directed, typed link between two entities (FR-007 to FR-009). It carries origin, confidence, an optional basis, and provenance. Several assertions of the same link from different sources coexist.
- **State Observation**: a normalized state (FR-014) and an optional verbatim source status for one entity at one observation time, with provenance. The latest one is the entity's current state, and all of them form its state history.
- **Event**: something that happened at a point in time. It has a type, an occurrence time and an observation time, one subject entity, optional related entities, an optional description, and provenance.
- **Import**: one submission by an Administrator: who, when, format, dry-run flag, per-kind row counts, and per-row rejection details. Every Source Record, Relationship, State Observation and Event links back to the import (or seed run) that delivered it.
- **Source System**: a named external system (for example "Order Management" or "WMS") that records come from. In this feature, it is identified by name only. Connection management is out of scope.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Starting from the entity list, a signed-in user can find Order #18492 and see its current state, the system that reported that state, and when it was reported, in under 30 seconds.
- **SC-002**: 100% of displayed states, relationships and events show their source system, source identifier and observation time, and 100% of displayed relationships show origin and confidence, verified by automated tests over the full seed.
- **SC-003**: With 50,000 entities in the data store, the entity list's first filtered page and an entity's detail page (with up to 1,000 relationships and 1,000 events) each load in under 2 seconds.
- **SC-004**: An import of 10,000 valid rows completes, including its report, in under 60 seconds.
- **SC-005**: For 100% of imports, received rows = created + updated + unchanged + rejected, and every rejected row has a row reference and a reason. Zero submitted rows or fields are silently lost, verified by tests that re-read stored raw payloads and compare them with the submitted input.
- **SC-006**: 100% of non-dry-run data changes from imports produce matching audit entries, and 100% of import attempts by signed-in non-Administrators are refused and audited, and 100% of unauthenticated attempts are refused.
- **SC-007**: On a fresh environment, the documented setup produces the reference scenario with exactly the counts and totals in FR-036 to FR-041, and a second run changes nothing. Both are verified by automated tests.
- **SC-008**: Neighbor lookup for an entity with 1,000 relationships returns its first page in under 500 milliseconds, and returns identical results for identical data.

## Assumptions

- **Scope boundaries**: The following are out of scope and belong to later features:
  - multi-hop traversal and blocker paths (003)
  - graph visualization (004)
  - root cause, evidence documents and confidence computation (005)
  - impact analysis (006)
  - risks, exceptions and investigations
- **Identity resolution**: Matching records across systems by heuristics is out of scope. Records join an existing entity only by exact source key or explicit reference (FR-019).
- **Conflict detection**: Formally flagging conflicts between sources is out of scope. This feature stores every observation with its source and shows each source's latest state on the detail page, so no source value is hidden (Constitution Principle II). Flagging conflicts as conflicts comes later.
- **No editing or deletion**: Entities, relationships, states and events cannot be edited or deleted in the interface in this feature. Data changes arrive only through import or seed. MANUAL relationships are created by Administrators through import, with a stated basis.
- **No import screen**: Import is an Administrator-only service operation with documented formats. A web screen for uploading files is not required in this feature. The entity list and detail pages are the only new screens.
- **Fixed vocabularies**: Entity types, relationship types, origins, confidences and normalized states are fixed vocabularies for the Logistics/Commerce MVP. Changing them is a code change, not a configuration change. Event types are open, within the naming rule in FR-018.
- **Seed counts**: The user's "≈17 orders, 4 customers" is read as 17 affected orders across 4 customers, matching the §39 figures exactly, plus at least 3 unaffected control orders (FR-040). The total seeded customer count is 4, all of whom are affected. The orders and SLAs make the difference between affected and unaffected visible.
- **Consolidated shipment**: To make one missing budget code plausibly affect 17 orders across 4 customers, the §39 shipment is modeled as a consolidated freight shipment that cannot leave until Order #18492 is released. This is the narrative device for the shared dependency. The exact relationship list for the 16 other orders is defined in the plan.
- **Times and money**: All times are stored in UTC, and the interface shows them in the viewer's local time with the timezone indicated. Seed amounts are in USD.
- **Existing foundation**: Sign-in, roles, the audit mechanism, the error format and shared-schema conventions come from feature 001 and are reused unchanged.
