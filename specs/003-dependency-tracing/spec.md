# Feature Specification: Dependency Tracing & Entity 360

**Feature Branch**: `003-dependency-tracing`
**Created**: 2026-10-06
**Status**: Draft
**Input**: User description: "Dependency tracing over the operational graph. Users can ask for any entity: "What does this depend on?" (upstream), "What depends on this?" (downstream), and "What is blocking this?" (blocking path following BLOCKS/REQUIRES/DEPENDS_ON edges to entities whose state is not satisfied). Implement traversal only inside GraphRepository using recursive queries with max depth (default 6, max 10), cycle guard, relationship-type and entity-type filters, and return explicit paths (ordered list of entity+relationship hops with origin and confidence per hop). Build the Entity 360 page (Product Overview §8): identity, relationships, current state, timeline, dependencies (upstream/downstream tabs), blockers with the full path shown as text ("Order #18492 is blocked because…"), and source evidence per hop. For the §39 seed scenario, tracing from Shipment must reach "Budget Code Missing" as the deepest blocker. Results must be deterministic. Performance: blocker path for one entity in a 50k-entity graph returns in under 1 second."

## Overview

Feature 002 gave OpsGraph its operational memory: entities, typed relationships, states, events and source records, plus one-hop neighbor lookup. This feature lets users **reason over** that memory. For any entity, a user can ask three questions and get an answer they can verify:

- **"What does this depend on?"** (upstream)
- **"What depends on this?"** (downstream)
- **"What is blocking this?"** (blocking paths)

Every answer is a set of explicit paths. Each hop names the relationship it follows, that relationship's origin and confidence, and the source evidence behind both the relationship and the state of the entity it reaches. Blocking paths are also explained in plain sentences ("Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING…").

The existing entity detail page becomes the **Entity 360** page (Product Overview §8). It brings identity, current state, blockers, upstream and downstream dependencies, relationships, timeline and source records together on one screen.

It does **not** deliver root-cause designation, impact metrics (orders/customers affected, revenue exposure), risk, exceptions, investigations or graph visualization. Those are later features that build on the traversal delivered here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - "What is blocking this?" with a readable, evidenced explanation (Priority: P1)

An Operations Analyst opens Shipment SHP-77120, which is DELAYED. Near the top of its Entity 360 page, a **Blockers** section answers "What is blocking this?" without any further action:

> Shipment SHP-77120 is DELAYED. 1 deepest blocker: **Budget code for Order #18492** (MISSING), 4 steps away.
>
> Shipment SHP-77120 is delayed because it depends on Order #18492, which is BLOCKED. Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING. Payment PAY-88213 is pending because it requires Finance approval APR-2291, which is BLOCKED. Finance approval APR-2291 is blocked because it requires Budget code for Order #18492, which is MISSING.

Below this explanation, the page shows a second blocking path, clearly labeled as resting on a **manually recorded** relationship of **medium** confidence: an analyst recorded that Payment PAY-88213 blocks the shipment. The page shows the analyst's stated basis.

For every step, the analyst can expand the evidence:

- the relationship as recorded (for example "Order #18492 REQUIRES Payment PAY-88213"), with its origin, confidence, basis where present, source system, source identifier and observation time;
- the state of the entity reached, with the source system that reported it and when;
- each source system's latest state when they disagree.

Every entity named in the explanation links to its own Entity 360 page.

**Why this priority**: "Why is this stuck?" is the core question of the product (§41) and the reference scenario (§39). Blocker paths are what turn the stored graph into an operational answer. Later root-cause and impact features build on this traversal.

**Independent Test**: Seed the reference scenario. Sign in as an Analyst and open Shipment SHP-77120. Check the Blockers section against acceptance scenarios 1 to 3. Repeat the request 100 times through the service interface and confirm identical results.

**Acceptance Scenarios**:

1. **Given** the seeded reference scenario, **When** blockers are requested for Shipment SHP-77120 with default settings, **Then**:
   - every returned blocking path ends at **Budget code for Order #18492** (state MISSING);
   - it is the only deepest blocker;
   - the first-ranked path is Shipment SHP-77120 → Order #18492 → Payment PAY-88213 → Finance approval APR-2291 → Budget code for Order #18492. Its 4 hops are all SOURCE / HIGH.
2. **Given** the same request, **When** the results are shown, **Then** a second path is also returned: Shipment SHP-77120 ← Payment PAY-88213 (via "PAY-88213 BLOCKS SHP-77120", MANUAL / MEDIUM) → Finance approval APR-2291 → Budget code for Order #18492. It ranks below the first path. Both the text and the structured hop mark it as manual with medium confidence and show its basis.
3. **Given** the seeded scenario, **When** blockers are requested for Order #18492, **Then**:
   - exactly one path is returned: Order #18492 → Payment PAY-88213 → Finance approval APR-2291 → Budget code for Order #18492;
   - the direct blocker is Payment PAY-88213, and the deepest blocker is the Budget code;
   - the explanation begins "Order #18492 is blocked because it requires Payment PAY-88213, which is PENDING."
4. **Given** the seeded scenario, **When** blockers are requested for Acme Corp's delivery SLA (AT_RISK), **Then** the deepest blocker is again the Budget code. The first hop (SLA DEPENDS_ON Shipment SHP-77120) is labeled INFERRED / MEDIUM in both the text and the structured result.
5. **Given** an entity whose dependencies are all satisfied (for example Warehouse WH-EAST-02), **When** blockers are requested, **Then** the result states that no blockers were found within the searched depth, and names that depth.
6. **Given** Order #18492, whose source systems disagree on its state (OMS: BLOCKED, ERP: PENDING), **When** it appears in a blocking path, **Then** the hop's evidence shows its current state and both per-source latest states. Neither value is hidden.
7. **Given** any blocker request, **When** it is repeated against unchanged data, **Then** the paths, their order, the hop details and the explanation text are identical.

---

### User Story 2 - Upstream and downstream dependencies (Priority: P1)

An Operations Manager opens the Budget code for Order #18492 and switches to the **Dependencies** section's **Downstream** tab ("What depends on this?"). They see every entity that depends on the Budget code, directly or transitively. Each entity shows its type, current state, distance in steps, and the path that connects it, with origin and confidence on every hop. They can:

- narrow the result to Orders only;
- restrict which relationship types are followed;
- change the search depth.

On the **Upstream** tab of Order #18492 ("What does this depend on?"), they see the customer, contract, payment, approval, budget code, warehouse, product and suppliers it relies on. The supplier that is only inferred is clearly labeled as such.

**Why this priority**: Upstream and downstream tracing are the two foundational questions in §11, and the basis for later impact analysis. They are independent of blocker semantics: they work for any entity whatever its state.

**Independent Test**: Seed the reference scenario. Request downstream of the Budget code and upstream of Order #18492 and of Shipment SHP-77120 with default settings. Compare the reached entities with acceptance scenarios 1 to 3. Then apply filters and depth changes and compare with scenarios 4 to 6.

**Acceptance Scenarios**:

1. **Given** the seeded scenario, **When** downstream is requested for the Budget code with default settings, **Then** exactly these 25 entities are reached:
   - the 17 affected orders (Order #18492 and the 16 orders on Shipment SHP-77120);
   - the 4 delivery SLAs;
   - Payment PAY-88213, Finance approval APR-2291, Shipment SHP-77120 and Invoice INV-55120.

   None of the control orders (#18530, #18531, #18532) is reached.
2. **Given** the seeded scenario, **When** upstream is requested for Order #18492 with default settings, **Then** exactly these 9 entities are reached:
   - Acme Corp, Contract CON-3982, Payment PAY-88213, Finance approval APR-2291, the Budget code, Warehouse WH-EAST-02 and Product PRD-5521;
   - Supplier Northwind Steel, through a SOURCE / HIGH relationship;
   - Supplier Contoso Metals, whose path ends in an INFERRED / LOW hop that is labeled as such.
3. **Given** the seeded scenario, **When** upstream is requested for Shipment SHP-77120, **Then**:
   - the result contains Order #18492, the 9 entities in scenario 2, and nothing else;
   - Payment PAY-88213 is shown with its two-step SOURCE / HIGH path through Order #18492. This path is preferred over the one-step MANUAL / MEDIUM "BLOCKS" path under the ranking rule in FR-016.
4. **Given** the downstream request in scenario 1, **When** it is filtered to entity type Order, **Then** exactly the 17 affected orders are listed, each still with its full path through the non-Order entities in between.
5. **Given** the downstream request in scenario 1, **When** it is restricted to relationship types REQUIRES and DEPENDS_ON, **Then** only those types are followed, and exactly 24 entities are reached: the 25 in scenario 1 minus Invoice INV-55120, which is reachable only through GENERATES. Shipment SHP-77120 is still reached, through its DEPENDS_ON relationship to Order #18492 rather than the BLOCKS relationship.
6. **Given** any dependency request, **When** depth 2 is chosen, **Then** no reached entity is more than 2 steps from the start. The result indicates whether more entities exist beyond that depth.
7. **Given** a reached entity, **When** the user selects it, **Then** they navigate to that entity's Entity 360 page.

---

### User Story 3 - Entity 360: the whole operational context on one page (Priority: P2)

An analyst opens any entity and sees its full operational context in one place, with the most relevant information first:

- **Identity**
- **Current state** and state history
- **Blockers**: shown prominently when present, otherwise a short "no blockers found" line
- **Dependencies** (Upstream / Downstream tabs)
- **Relationships**
- **Timeline**
- **Source records**

The tracing views are lists of paths with plain-language text, never a bare diagram. The analyst can copy the page link, with the chosen dependency tab, depth and filters, and send it to a colleague, who sees the same view.

**Why this priority**: The Entity 360 page is where users meet tracing. It reuses the sections built in feature 002, so most of its value comes from Stories 1 and 2. Assembling, ordering and making the page shareable is P2.

**Independent Test**: Seed the reference scenario. Open Order #18492, Shipment SHP-77120, Acme Corp and Warehouse WH-EAST-02. Check that each shows every section in FR-027 in the stated order. Check that the Blockers section is prominent only where blockers exist. Copy a link with Downstream, depth 3 and an Order filter, and confirm a second user opening it sees the same tab, depth, filter and results.

**Acceptance Scenarios**:

1. **Given** any seeded entity, **When** its Entity 360 page is opened, **Then** it shows Identity, Current state, Blockers, Dependencies, Relationships, Timeline and Source records, in that order.
2. **Given** an entity with blockers, **When** its page is opened, **Then** the deepest blocker summary and the first-ranked explanation are visible without scrolling on a standard laptop screen (1366×768 or larger).
3. **Given** a link copied from the Dependencies section with a chosen tab, depth and filters, **When** another signed-in user opens it, **Then** they see the same tab, depth, filters and results.
4. **Given** a user who is not signed in, **When** they request an Entity 360 page or any tracing result, **Then** access is refused.
5. **Given** any signed-in role (Administrator, Operations Manager, Operations Analyst), **When** they use any tracing capability, **Then** it works and changes no data.

---

### Edge Cases

- **Cycles**: when a path reaches an entity already on that path (for example A REQUIRES B and B REQUIRES A), the closing hop is not followed. Traversal terminates. The result lists every cycle-closing relationship it skipped. In a blocker query, an unsatisfied entity whose only unsatisfied dependencies lie on its own path is reported as a deepest blocker and flagged as part of a dependency cycle.
- **Depth limit reached**: if a path stops at the depth limit while the last entity still has followable relationships, the path is flagged "continues beyond depth limit". In a blocker query, that entity is reported as "deepest blocker found within depth N", never as the definitive deepest blocker.
- **Invalid depth**: a depth below 1, above 10 or not a whole number is rejected with a validation error stating the allowed range. It is never silently adjusted.
- **Invalid filters**:
  - unknown entity types and unknown relationship types are rejected, and the error lists the allowed values;
  - RELATES_TO is rejected for every query, because it carries no dependency meaning (FR-005);
  - a type outside REQUIRES, DEPENDS_ON and BLOCKS is rejected for blocker queries.
- **Unknown or nonexistent start entity**: refused as not found.
- **Isolated entity**: an entity with no followable relationships returns an empty result that says so, not an error.
- **Start entity is satisfied**: blocker queries still run. If no unsatisfied dependency is found, the result says so (Story 1, scenario 5).
- **Entity with UNKNOWN state**: it is never treated as satisfied or as a confirmed blocker. It appears in blocking paths as a **possible blocker (state unknown)**, and traversal continues past it so real blockers behind it stay visible.
- **Same relationship asserted by several sources** (feature 002, FR-013): it forms one hop, which lists every assertion with its own provenance. The hop's effective origin and confidence follow FR-012.
- **Parallel distinct relationships** (for example "A DEPENDS_ON B" and "B BLOCKS A"): they are distinct hops and can produce distinct paths. Ranking (FR-016) makes the order deterministic.
- **Relationship traversed against its stored direction** (BLOCKS, PLACED, GOVERNS and the others in FR-005): the hop shows the relationship exactly as recorded ("Payment PAY-88213 BLOCKS Shipment SHP-77120"), so the text never inverts a sourced fact.
- **Very high fan-out** (for example downstream of a warehouse with thousands of orders):
  - results are paginated;
  - traversal stops after the exploration limit in FR-021 and flags the result as truncated;
  - the result is never silently incomplete.
- **Many blocking paths**: at most the number of paths in FR-021 is returned, the highest ranked first, and the result is flagged as truncated when more exist.
- **Data changes between page requests**: each result states when it was computed. Later pages are computed against the current data. If the data changed in between, the user sees a newer computed time and can refresh.

## Requirements *(mandatory)*

### Functional Requirements

**Dependency semantics**

- **FR-001**: System MUST support three tracing queries for any entity:
  - **upstream**: what the entity depends on, directly or transitively;
  - **downstream**: what depends on the entity, directly or transitively;
  - **blockers**: which unsatisfied entities are preventing it from progressing, and through which paths.
- **FR-002**: For every relationship type except RELATES_TO, System MUST apply exactly this dependency direction. "Dependent" is the entity that relies on the other.

  | Relationship as recorded | Dependent | Depended-on | Meaning |
  |---|---|---|---|
  | A REQUIRES B | A | B | A cannot progress without B |
  | A DEPENDS_ON B | A | B | A cannot progress without B |
  | A BLOCKS B | B | A | B cannot progress until A clears |
  | A FULFILLED_BY B | A | B | the Order or Shipment relies on the Warehouse |
  | A SUPPLIED_BY B | A | B | the Product relies on the Supplier |
  | A CONTAINS B | A | B | the Order relies on the Product |
  | A PLACED B | B | A | the Order exists for the Customer |
  | A HAS B | B | A | the Contract belongs to the Customer |
  | A GOVERNS B | B | A | the Order is governed by the Contract |
  | A DEFINES B | B | A | the SLA or Budget Requirement comes from the Contract |
  | A GENERATES B | B | A | the Invoice comes from the Order |

- **FR-003**: Upstream traversal MUST move from dependent to depended-on. Downstream traversal MUST move from depended-on to dependent.
- **FR-004**: By default, upstream and downstream MUST follow every relationship type in FR-002. Blocker traversal MUST follow only REQUIRES, DEPENDS_ON and BLOCKS, and a filter may narrow that set but never widen it.
- **FR-005**: RELATES_TO relationships MUST never be followed by any tracing query.

**Satisfied and unsatisfied states**

- **FR-006**: For blocker evaluation, System MUST classify every entity's **current** state (as defined in feature 002, FR-015):
  - **satisfied**: ACTIVE, COMPLETED, AT_RISK (at risk, but not yet preventing progress);
  - **unsatisfied**: PENDING, WAITING, BLOCKED, MISSING, DELAYED, FAILED, CANCELLED, SUSPENDED;
  - **indeterminate**: UNKNOWN.
- **FR-007**: A blocking path MUST start at the requested entity, whatever that entity's own state is. Every later entity on the path MUST be unsatisfied or indeterminate. Traversal MUST NOT continue through a satisfied entity, and a satisfied entity MUST NOT appear in a blocking path.
- **FR-008**: Each blocker query MUST identify:
  - the **direct blockers**: unsatisfied or indeterminate entities one hop away;
  - the **deepest blockers**: unsatisfied or indeterminate entities at the end of a blocking path that have no further unsatisfied or indeterminate dependency.

  An indeterminate entity MUST be labeled "possible blocker (state unknown)", never presented as a confirmed blocker.

**Traversal limits and safety**

- **FR-009**: Every tracing query MUST take a maximum depth, counted in hops from the start entity. The default is 6, the minimum 1 and the maximum 10. Values outside this range MUST be rejected with a validation error, never adjusted silently.
- **FR-010**: No entity MAY appear twice in one path. Traversal MUST terminate on cyclic data. The result MUST list the cycle-closing relationships it skipped.
- **FR-011**: Tracing queries MUST accept these optional filters:
  - **relationship types**: limits which relationship types are followed (see FR-004 and FR-005);
  - **entity types**: limits which reached entities are **reported**. Traversal still passes through entities of other types, and reported paths still show every hop. In blocker queries, a path is reported only if it contains at least one blocker of a selected type.

**Paths, hops and evidence**

- **FR-012**: Every result MUST express connections as explicit paths: the start entity followed by an ordered list of hops. Each hop MUST contain:
  - the relationship exactly as recorded (from entity, type, to entity) and whether this hop follows it forward or against its recorded direction;
  - every assertion of that relationship (feature 002, FR-013), each with its origin, confidence, basis where present, source system, source identifier and observation time;
  - the hop's **effective origin**: SOURCE if any assertion is SOURCE, otherwise MANUAL if any is MANUAL, otherwise INFERRED;
  - the hop's **effective confidence**: the highest confidence among the assertions that have the effective origin;
  - the entity reached: its identifier, type and display name, its current state with the source system and observation time of that state, and each source system's latest state when they disagree.
- **FR-013**: Every result MUST state:
  - the query that produced it: start entity, query kind, depth, and filters;
  - when it was computed;
  - whether it was truncated by the depth limit or the exploration limit (FR-021).
- **FR-014**: Upstream and downstream results MUST list each reached entity once, with its distance (the length of its shortest path) and one canonical path, chosen by FR-016. The total number of reached entities MUST be reported.
- **FR-015**: Blocker results MUST list every distinct blocking path up to the limit in FR-021, in FR-016 order. They MUST also list the distinct direct blockers and deepest blockers, each with the length of the highest-ranked blocking path that reaches it. This is the path the explanation uses, so the stated distance always matches the explanation shown.
- **FR-016**: When paths are ranked, or a canonical path is chosen, System MUST order them by these rules, in order:
  1. Higher weakest-hop effective confidence first. A path is only as strong as its weakest hop.
  2. Fewer hops whose effective origin is not SOURCE first.
  3. Fewer hops first.
  4. Ascending lexical order of the sequence of entity identifiers along the path, then of relationship identifiers, as a final tie-break.

  Reached entities in upstream and downstream results MUST be listed by distance, then entity type, then display name, then identifier.
- **FR-017**: Given identical data and an identical query, every tracing result MUST be identical in content and order, except for the computed time.

**Plain-language explanation**

- **FR-018**: Every blocking path MUST come with a plain-language explanation. It has one sentence per hop, of the form "‹X› is ‹state of X› because it ‹relationship phrase› ‹Y›, which is ‹state of Y›." The first sentence uses the start entity's own state.

  The text MUST:
  - read correctly for hops followed against their recorded direction (for example "…because Payment PAY-88213, which is PENDING, blocks it");
  - be generated deterministically from the path data alone, never by a probabilistic or AI component.
- **FR-019**: In the explanation, any hop whose effective origin is not SOURCE MUST state that it is inferred or manually recorded, with its confidence and basis. An indeterminate entity MUST be described as "whose state is unknown". Text MUST NOT present inference as fact.
- **FR-020**: Each blocker result MUST begin with a one-line summary: the start entity's state, the number of deepest blockers, and the first-ranked deepest blocker with its state and distance. If none is found, it says so and names the searched depth.

**Limits and performance**

- **FR-021**: To bound work on large graphs, the system MUST stop and flag the result as truncated when one of these limits is reached:
  - a single upstream or downstream query explores more than 10,000 entities;
  - a blocker query finds more than 100 blocking paths.

  Upstream and downstream results MUST be paginated, with a default page size of 50 and a maximum of 200.
- **FR-022**: Multi-hop traversal MUST be performed only by the central graph-reading capability introduced in feature 002 (FR-047), extended by this feature. No other part of the system MAY traverse relationships. This replaces feature 002's FR-048 restriction on multi-hop traversal.

**Access**

- **FR-023**: All signed-in roles MUST be able to use every tracing query and the Entity 360 page. Unauthenticated callers MUST be refused.
- **FR-024**: Tracing MUST be read-only. It changes no data and so writes no data-change audit entries. Refused attempts follow the existing rules from features 001 and 002.
- **FR-025**: A request for a nonexistent entity MUST be refused as not found. An invalid depth or filter MUST be refused with a validation error that names the offending field and the allowed values.

**Entity 360 page**

- **FR-026**: The entity detail page from feature 002 MUST become the Entity 360 page at the same address. Existing links to entity details MUST keep working.
- **FR-027**: The Entity 360 page MUST show, in this order:
  1. **Identity** (as in feature 002)
  2. **Current state** (as in feature 002)
  3. **Blockers**:
     - the FR-020 summary;
     - each blocking path's explanation, highest ranked first;
     - per hop, expandable evidence as in FR-012;
     - visible labels on non-SOURCE hops, indeterminate entities, cycles and truncation.
  4. **Dependencies**: Upstream and Downstream tabs. Each tab offers depth, relationship-type and entity-type controls. Each reached entity shows its type, display name, current state and distance, and has an expandable path with origin and confidence on every hop.
  5. **Relationships** (as in feature 002)
  6. **Timeline** (as in feature 002)
  7. **Source records** (as in feature 002)
- **FR-028**: When an entity has at least one blocker, the Blockers summary and the first-ranked explanation MUST appear before the Dependencies section, and be visible without scrolling at 1366×768. When there are none, the section MUST be reduced to a single line.
- **FR-029**: Every entity named in a path, explanation or dependency list MUST link to that entity's Entity 360 page.
- **FR-030**: The chosen dependency tab, depth and filters MUST be reflected in the page address, so that opening a copied link reproduces the same view.
- **FR-031**: Every tracing view MUST present text and structured lists. This feature MUST NOT introduce a graph diagram (that is feature 004).
- **FR-032**: The Entity 360 page MUST NOT show sections for risks, exceptions, impact or investigations, not even as empty placeholders. Those arrive with their own features.

**Shared contracts and tests**

- **FR-033**: Every new request and response payload MUST be defined once as a shared, validated schema, used by both the backend and the web app. Every new endpoint MUST have end-to-end tests covering its success path, its authentication failure and its validation failure, following the conventions of features 001 and 002.
- **FR-034**: Traversal MUST have automated tests covering at least:
  - cycles (two-node and longer);
  - the depth limit at 1, the default and 10;
  - each filter;
  - the tie-breaking rules in FR-016;
  - effective origin and confidence with multiple assertions;
  - indeterminate (UNKNOWN) entities;
  - truncation;
  - every acceptance scenario in Stories 1 and 2 against the seeded reference scenario.

### Key Entities

- **Tracing Query**: a request to trace from one start entity. It has a kind (upstream, downstream, blockers), a maximum depth, and optional relationship-type and entity-type filters. It is not stored. It is echoed back in every result.
- **Dependency Direction Rule**: the fixed mapping in FR-002 from each relationship type to its dependent and depended-on ends. It lets every typed relationship from feature 002 be read as a dependency, in the right direction.
- **Hop**: one step along one relationship, as specified in FR-012.
- **Path**: a start entity plus an ordered list of hops in which no entity repeats. It carries its length, weakest-hop confidence, count of non-SOURCE hops, and flags for depth truncation and cycle-closing. Blocking paths also carry a plain-language explanation.
- **Blocker**: an unsatisfied or indeterminate entity on a blocking path. It is classified as direct (one hop away) and/or deepest (no further unsatisfied or indeterminate dependency), with the length of the highest-ranked path that reaches it.
- **Tracing Result**: the echoed query, the computed time, the truncation flags, the skipped cycle-closing relationships, and either reached entities with canonical paths (upstream/downstream, paginated) or blocking paths with direct and deepest blockers and a summary (blockers).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Starting from the entity list, a signed-in user can open Order #18492 and read why it is blocked, down to the missing budget code, in under 30 seconds, without leaving the Entity 360 page.
- **SC-002**: On the seeded reference scenario, 100% of the acceptance scenarios in Stories 1 and 2 pass in automated tests. Every blocker path from Shipment SHP-77120 ends at the missing Budget code.
- **SC-003**: In a data store with 50,000 entities and at least 150,000 relationships, a blocker query for one entity whose blocking chain is 6 hops deep returns in under 1 second at the 95th percentile over 20 runs.
- **SC-004**: In the same data store, the first page of an upstream or downstream query at default depth returns in under 2 seconds at the 95th percentile. The Entity 360 page shows its Identity, Current state and Blockers sections in under 3 seconds.
- **SC-005**: 100 consecutive executions of each acceptance query against unchanged data produce identical results (excluding computed time), verified by automated tests.
- **SC-006**: 100% of returned hops carry an effective origin, an effective confidence, and source system, source identifier and observation time for both the relationship and the reached entity's state. 100% of non-SOURCE hops are labeled as inferred or manual in the explanation text. Both are verified by automated tests over the full seed.
- **SC-007**: On generated graphs containing cycles, every query terminates, no path exceeds the requested depth, and no entity repeats within any path. This is verified by automated tests over at least 1,000 generated graphs.

## Assumptions

- **Scope boundaries**: The following are out of scope and belong to later features:
  - graph visualization (004)
  - root-cause designation, confidence computation and evidence documents (005). In particular, §39's "Root Cause" and "Immediate Blocker" labels are root-cause conclusions, and may differ from this feature's purely structural "deepest blocker" and "direct blocker".
  - impact metrics such as orders and customers affected, SLA risks and revenue exposure (006)
  - risks, exceptions, investigations and what-if analysis
- **Satisfied states**: The user's phrase "state is not satisfied" is taken to mean the classification in FR-006:
  - AT_RISK counts as satisfied, because it signals a possible future problem, not a current stoppage. Risk is handled by a later feature.
  - CANCELLED counts as unsatisfied, because a dependent cannot progress on a cancelled dependency.
  - UNKNOWN is shown as a possible blocker rather than guessed either way, consistent with the fact-vs-inference principle.
- **Dependency direction**: The user named BLOCKS, REQUIRES and DEPENDS_ON for blocker paths only. For upstream and downstream, this spec reads every typed relationship except RELATES_TO as a dependency, in the direction given in FR-002, so that "what does this depend on?" includes the customer, contract, warehouse and supplier context (§8, §39). Users can narrow this with the relationship-type filter.
- **Multiple paths**: Upstream and downstream show one canonical path per reached entity, because the number of distinct paths can grow combinatorially on large graphs. Blocker queries show every distinct path up to the limit, because traversal only passes through unsatisfied entities, which keeps that set small, and because alternative explanations matter there.
- **Evidence ranking over brevity**: Path ranking puts strength of evidence before length, so a fully sourced explanation is preferred over a shorter one that rests on a manual or inferred link (Constitution Principle II).
- **Source disagreement**: Blocker evaluation uses each entity's current state as defined in feature 002. Where sources disagree, both values are shown on the hop. Formal conflict flagging remains a later feature.
- **No stored results**: Tracing results are computed on demand and are not persisted. Saving an analysis belongs to Investigations.
- **Performance dataset**: The 50,000-entity performance graph reuses or extends the generated dataset from feature 002's performance suite.
- **Existing foundation**: Sign-in, roles, the error format, the audit mechanism, shared-schema conventions, the entity data model, the reference seed and one-hop neighbor lookup come from features 001 and 002 and are reused unchanged, except for the FR-048 restriction lifted by FR-022.
