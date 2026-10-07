# Feature Specification: Graph Explorer

**Feature Branch**: `004-graph-explorer`
**Created**: 2026-10-06
**Status**: Draft
**Input**: User description: "Graph Explorer (Product Overview §22) for the operational graph. Users open the explorer focused on one entity and see only its relevant neighborhood (default 2 hops, never the whole graph). Support zoom, pan, node select, relationship select, expand/collapse a node's neighbors, focus mode, filters by entity type and relationship type, upstream-only / downstream-only views, and highlighting of blocker paths using the existing dependency-tracing API. Edges show origin (SOURCE/INFERRED/MANUAL) and confidence visually (e.g. dashed = inferred). Selecting a node opens a side panel with status, source system, "Blocked by", "Blocks", evidence/source records, and a link to Entity 360. The graph view must always be paired with a textual list of the same nodes/paths (the product must not be reduced to a graph viewer). Must stay usable at 200 visible nodes; beyond that show "N more — refine filters". Reuse existing tracing endpoints; add only a neighborhood endpoint if needed (through GraphRepository)."

## Overview

Features 002 and 003 gave OpsGraph its operational memory and the ability to reason over it: upstream, downstream and blocker tracing, explained as text on the Entity 360 page. This feature adds the **Graph Explorer** (Product Overview §22): a visual map of how one entity connects to the things around it.

The explorer always starts from **one focus entity** and shows only its **neighborhood**: by default, everything within 2 relationship steps. It never draws the whole graph. From there the user can:

- zoom, pan, and select nodes and relationships;
- expand or collapse individual nodes;
- narrow the view by entity type, relationship type and direction (upstream only / downstream only);
- highlight the paths that block the focus entity, reusing the blocker tracing from feature 003.

Every relationship drawn shows whether it is a sourced fact, an inference or a manual record, and how confident it is. Selecting a node opens a side panel with its status, source, what blocks it, what it blocks, its evidence, and a link to its Entity 360 page.

The graph is never shown alone. A **textual list** of the same nodes and relationships sits beside it and stays in sync with it, and blocker highlighting comes with the same plain-language explanation as the Entity 360 page (§3, §45).

This feature does **not** deliver risk highlighting, impact highlighting or history inspection (§22). Those depend on the risk, impact and timeline-replay features that come later.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See an entity's neighborhood as a graph and as a list (Priority: P1)

An Operations Analyst is on the Entity 360 page of Order #18492 and selects **Open in Graph Explorer**. The explorer opens focused on Order #18492. It shows the order, clearly marked as the focus, and every entity within 2 steps:

- one step: Acme Corp, Contract CON-3982, Payment PAY-88213, Warehouse WH-EAST-02, Product PRD-5521, Shipment SHP-77120, Invoice INV-55120, and the order's other direct neighbors;
- two steps: Finance approval APR-2291, the suppliers, the other orders on Shipment SHP-77120, and so on.

Upstream entities are laid out on one side of the focus and downstream entities on the other. Beside the graph, a **list** shows the same entities, grouped by distance, each with its type, name, current state and the relationship that connects it. Above both, a line states what is shown: "Order #18492 — all directions, 2 steps: 31 entities, 38 relationships" (example figures).

The analyst zooms in, pans across the graph, and clicks Payment PAY-88213. It is highlighted in both the graph and the list. A side panel opens:

> **Payment PAY-88213** — PENDING (reported by Payment System, 2026-10-04 09:12)
> **Blocked by:** Finance approval APR-2291 (BLOCKED)
> **Blocks:** Order #18492, Shipment SHP-77120 (manual, medium confidence)
> **Evidence:** 2 source records · 4 relationship assertions
> **Open Entity 360 →**

The analyst then clicks the relationship between the order and the payment. The panel now shows it as recorded ("Order #18492 REQUIRES Payment PAY-88213"), with every source that asserted it, each with its origin, confidence, source system, source identifier and observation time.

**Why this priority**: This is the explorer. Without a bounded neighborhood, paired list and contextual panel, there is nothing to filter or highlight. On its own it already answers "what is this connected to, and how sure are we?" visually.

**Independent Test**: Seed the reference scenario. Sign in as an Analyst, open Order #18492 in the explorer, and check acceptance scenarios 1 to 8.

**Acceptance Scenarios**:

1. **Given** the seeded reference scenario, **When** the explorer is opened focused on Order #18492 with default settings, **Then** it shows exactly the entities within 2 steps of the order, ignoring relationship direction, and the relationships among them. No entity farther away is shown. The focus entity is visually distinct.
2. **Given** the same view, **When** the user compares the graph and the list, **Then** they contain exactly the same entities and relationships, and the header states the same counts.
3. **Given** the view, **When** the user zooms and pans, **Then** the graph moves and scales smoothly, and the list and side panel are unaffected. A control resets the view to fit all visible nodes.
4. **Given** the view, **When** the user selects Payment PAY-88213 in either the graph or the list, **Then** it is highlighted in both, and the side panel shows its current state with source system and observation time, "Blocked by", "Blocks", its source records, and a link to its Entity 360 page.
5. **Given** the view, **When** the user selects the relationship "PAY-88213 BLOCKS SHP-77120", **Then** the side panel shows the relationship as recorded, its effective origin MANUAL and confidence MEDIUM, the analyst's stated basis, and the assertion's provenance.
6. **Given** the view, **When** the user looks at the relationships, **Then** SOURCE, INFERRED and MANUAL relationships are drawn in visibly different line styles, confidence is visibly distinguished, and a legend explains both. The same origin and confidence also appear as text in the list and the side panel.
7. **Given** Order #18492, whose sources disagree on its state (OMS: BLOCKED, ERP: PENDING), **When** it is shown, **Then** its node and list entry carry a conflict indicator, and its side panel shows both per-source states. Neither value is hidden.
8. **Given** any node in the panel, **When** the user selects "Open Entity 360", **Then** they navigate to that entity's Entity 360 page.

---

### User Story 2 - Highlight what is blocking the focus entity (Priority: P1)

An analyst opens Shipment SHP-77120 (DELAYED) in the explorer and turns on **Highlight blockers**. The two blocking paths from feature 003 are highlighted on the graph:

1. Shipment SHP-77120 → Order #18492 → Payment PAY-88213 → Finance approval APR-2291 → Budget code for Order #18492;
2. Shipment SHP-77120 ← Payment PAY-88213 (manual, medium) → Finance approval APR-2291 → Budget code for Order #18492.

The Budget code is 4 steps away, beyond the default 2-step neighborhood, so the entities on the blocking paths are added to the view and marked as "shown because they are on a blocking path". The Budget code is marked as the **deepest blocker**. Everything not on a blocking path is dimmed.

The text panel shows the same summary and explanation as the Entity 360 page: "Shipment SHP-77120 is DELAYED. 1 deepest blocker: Budget code for Order #18492 (MISSING), 4 steps away." The analyst can step through the paths; selecting a path highlights only that path on the graph.

**Why this priority**: "Why is this stuck?" is the core question of the product (§41). A visual blocker path, paired with the evidenced explanation, is the explorer's main contribution to an investigation.

**Independent Test**: Seed the reference scenario. Open Shipment SHP-77120 and Order #18492 in the explorer, turn on blocker highlighting, and compare the highlighted paths and text with feature 003's acceptance fixtures for the same entities.

**Acceptance Scenarios**:

1. **Given** the explorer focused on Shipment SHP-77120, **When** blocker highlighting is turned on, **Then** exactly the blocking paths returned by feature 003 for that entity at its default depth are highlighted, in the same rank order, and the Budget code is marked as the deepest blocker.
2. **Given** the same view, **When** a blocking path reaches entities outside the current neighborhood, **Then** those entities and relationships are added to the view, marked as added by a blocking path, and listed in the text list too.
3. **Given** the same view, **When** the user selects the second-ranked path, **Then** only that path is highlighted, and its MANUAL / MEDIUM hop is labeled as such in the graph and in the text.
4. **Given** Warehouse WH-EAST-02, whose dependencies are all satisfied, **When** blocker highlighting is turned on, **Then** nothing is highlighted and the text states that no blockers were found within the searched depth, naming that depth.
5. **Given** a view with blocker highlighting on, **When** it is turned off, **Then** entities that were added only by the blocking paths are removed, and the view returns to the plain neighborhood.
6. **Given** blocker results that are truncated, involve cycles, or contain entities of unknown state, **When** they are highlighted, **Then** the same labels as feature 003 appear: "truncated", "part of a dependency cycle", "possible blocker (state unknown)", "deepest blocker found within depth N".

---

### User Story 3 - Narrow the view: filters, direction, expand, collapse, focus (Priority: P2)

An Operations Manager opens the Budget code for Order #18492 in the explorer and wants to see only what it holds up. They:

- switch the direction to **Downstream only**: only entities that depend on the Budget code, directly or transitively within the step limit, remain;
- raise the step limit to 4: the affected orders and the shipment appear;
- filter the entity types to **Order** and **Shipment**: other entity types are hidden, except those needed to connect a visible entity back to the focus, which stay as small, dimmed "connector" nodes;
- **expand** Shipment SHP-77120 to bring in its direct neighbors, then **collapse** it to remove them again;
- turn on **focus mode** on Payment PAY-88213: only the payment and the entities directly connected to it stay fully visible, and the rest is dimmed;
- choose **Explore from here** on Order #18492: the explorer re-centers on the order and loads its neighborhood.

They copy the page link and send it to a colleague, who sees the same focus, direction, step limit, filters and blocker highlighting.

**Why this priority**: These controls keep the explorer useful as the neighborhood grows (§22: "remain useful even when a graph becomes large"). They refine the core views of Stories 1 and 2 rather than replace them.

**Independent Test**: Seed the reference scenario. Open the Budget code in the explorer and apply each control in turn. Compare the visible entities with the feature 003 downstream fixtures and acceptance scenarios 1 to 8.

**Acceptance Scenarios**:

1. **Given** the explorer focused on the Budget code, **When** Downstream only is selected with step limit 4, **Then** the visible entities are exactly those that feature 003's downstream query reaches within depth 4, plus the focus, and every visible relationship is one that query follows.
2. **Given** the explorer focused on Order #18492, **When** Upstream only is selected with the default step limit, **Then** only entities the order depends on within 2 steps are shown, per the dependency directions in feature 003 (FR-002).
3. **Given** a relationship-type filter, **When** it is applied, **Then** only relationships of the selected types are followed and shown, and entities reachable only through other types disappear.
4. **Given** an entity-type filter, **When** it is applied, **Then** entities of the selected types are shown normally, entities of other types are shown only as connectors when they lie between a shown entity and the focus, and all other entities are hidden. The focus entity is always shown.
5. **Given** a node with neighbors not yet visible, **When** the user expands it, **Then** its direct neighbors that pass the active filters and direction are added and marked as added by that expansion. **When** the user collapses it, **Then** exactly the entities added by that expansion, and not otherwise visible, are removed.
6. **Given** a selected node, **When** focus mode is turned on, **Then** that node, its direct relationships and its direct neighbors stay fully visible, and everything else is dimmed but not removed. Turning focus mode off restores the view.
7. **Given** a selected node, **When** the user chooses Explore from here, **Then** the explorer re-centers on it with the current direction, step limit and filters, and the browser's back action returns to the previous focus.
8. **Given** a link copied from the explorer, **When** another signed-in user opens it, **Then** they see the same focus entity, direction, step limit, filters and blocker-highlighting setting, and the same visible entities and relationships.

---

### User Story 4 - Large neighborhoods stay usable (Priority: P2)

An analyst opens Warehouse WH-EAST-02, which fulfills thousands of orders. The explorer does not try to draw them all. It shows the 200 highest-priority entities and a clear message: "Showing 200 of 4,312 entities — 4,112 more. Refine filters, reduce the step limit, or choose a direction." Panning, zooming and selecting remain smooth.

**Why this priority**: §22 requires the graph to stay useful at scale, and the warehouse case is common in logistics. It only matters once Stories 1 to 3 exist.

**Independent Test**: Using the 50,000-entity performance dataset, open a high-fan-out entity in the explorer and check acceptance scenarios 1 to 4, including the timing in SC-003 and SC-004.

**Acceptance Scenarios**:

1. **Given** a neighborhood larger than 200 entities, **When** the explorer opens, **Then** exactly 200 entities are visible (including the focus), chosen by the priority rule in FR-012, and the message states how many more exist and suggests refining filters.
2. **Given** a view already at 200 entities, **When** the user expands a node or turns on blocker highlighting, **Then** no more than 200 entities become visible in total; the message states how many were left out. Blocking-path entities take priority over ordinary neighbors, so the full first-ranked blocking path is always shown.
3. **Given** a neighborhood so large that counting it fully would exceed the exploration limit, **When** the explorer opens, **Then** the message states a lower bound ("more than 10,000") rather than an exact figure, and the result is labeled truncated.
4. **Given** the same data and settings, **When** the explorer is opened twice, **Then** the same 200 entities are shown in the same arrangement.

---

### Edge Cases

- **No focus entity**: opening the explorer without an entity shows an entity picker and a short explanation. It never shows the whole graph or a random part of it.
- **Nonexistent or invalid focus entity**: the user sees a "not found" message with a way back to the entity list.
- **Isolated entity**: the explorer shows the focus alone, with a message that it has no relationships matching the current settings, and a hint to widen filters if any are active.
- **Filters remove everything**: only the focus is shown, with a message naming the filters that excluded the rest.
- **Invalid settings in a shared link** (unknown type, step limit out of range): the explorer shows a validation message naming the invalid setting and its allowed values. It does not silently drop or adjust it.
- **RELATES_TO relationships**: they carry no dependency direction (feature 003, FR-005). They appear in the all-directions view, drawn as undirected context, and never in Upstream-only, Downstream-only or blocker views.
- **Cycles**: an entity is shown once, however many paths reach it. Cycles appear as closed loops in the graph and as relationships in the list. They never cause repeated or unbounded loading.
- **Parallel relationships** between the same two entities (for example "A DEPENDS_ON B" and "B BLOCKS A"): each is drawn and listed as a distinct relationship, and each is separately selectable.
- **Relationship asserted by several sources**: it is drawn once, with its effective origin and confidence (feature 003, FR-012). The panel lists every assertion.
- **Relationship followed against its recorded direction**: it is always drawn and labeled as recorded (for example "PAY-88213 BLOCKS SHP-77120"), never inverted.
- **Expanding an entity whose neighbors are already visible**: nothing is added; the expansion is still recorded so the node shows as expanded.
- **Collapsing the focus entity**: not allowed. The focus's neighborhood is controlled by the step limit.
- **Collapsing a node whose added neighbors are also reachable another way**: entities still connected through the neighborhood, another expansion or a highlighted blocking path stay visible.
- **Data changes while the explorer is open**: the view states when it was loaded and offers a refresh. Expansions loaded later may reflect newer data; each states its own load time.
- **Unknown state**: an entity with UNKNOWN state is shown with a distinct "state unknown" marker, never styled as satisfied or as a confirmed blocker.

## Requirements *(mandatory)*

### Functional Requirements

**Opening the explorer**

- **FR-001**: The explorer MUST always be focused on exactly one entity. It MUST NOT load or display the whole graph, or any part of it not anchored to the focus.
- **FR-002**: Users MUST be able to open the explorer:
  - from an "Open in Graph Explorer" action on every Entity 360 page;
  - from the existing Graph Explorer navigation entry, which shows an entity picker until an entity is chosen;
  - from any node in the explorer, with "Explore from here" (re-center).
- **FR-003**: The focus entity, direction, step limit, entity-type filter, relationship-type filter and blocker-highlighting setting MUST be reflected in the page address, so that a copied link reproduces the same view. Each re-center MUST create a browser history entry.

**Neighborhood**

- **FR-004**: The explorer MUST show the **neighborhood** of the focus entity: every entity reachable from it within the step limit, and the relationships among the shown entities that the current settings follow. The default step limit is 2, the minimum 1 and the maximum 4. Values outside this range MUST be rejected with a validation message, never adjusted silently.
- **FR-005**: The explorer MUST offer three directions:
  - **All directions** (default): steps follow any relationship type, in either direction, including RELATES_TO;
  - **Upstream only**: every step goes from dependent to depended-on, using the dependency directions in feature 003 (FR-002);
  - **Downstream only**: every step goes from depended-on to dependent, using the same directions.

  Upstream only and Downstream only MUST NOT follow RELATES_TO, and MUST reach exactly the entities that feature 003's upstream and downstream queries reach at the same depth and with the same filters.
- **FR-006**: Users MUST be able to filter by **relationship type**: only selected types are followed and shown.
- **FR-007**: Users MUST be able to filter by **entity type**. Traversal still passes through other types, as in feature 003 (FR-011). Entities of selected types are shown normally. Entities of other types are shown as dimmed **connector** nodes only when they lie on the shortest connection between a shown entity and the focus, and are otherwise hidden. The focus entity is always shown.
- **FR-008**: Each entity MUST be shown once, however many paths reach it, with its distance from the focus (the length of its shortest connection under the current settings).

**Drawing**

- **FR-009**: Every node MUST show the entity's type, display name and current state. The focus entity MUST be visually distinct. Entities with disagreeing source states MUST carry a conflict indicator. Entities in UNKNOWN state MUST carry a "state unknown" marker. Type and state MUST be distinguishable without relying on color alone.
- **FR-010**: Every relationship MUST be drawn with its recorded direction and type, and MUST show its **effective origin** and **effective confidence** (feature 003, FR-012) visually:
  - SOURCE as a solid line, INFERRED as a dashed line, MANUAL as a dotted line;
  - confidence HIGH, MEDIUM and LOW as distinct line weights or emphasis, with LOW the least prominent;
  - RELATES_TO as undirected context, visually distinct from dependency relationships.

  A legend MUST explain every style. Origin and confidence MUST also be readable as text, so they never depend on line style alone.
- **FR-011**: The layout MUST place the focus at the center, depended-on (upstream) entities to one side and dependent (downstream) entities to the other, ordered by distance. The same data and settings MUST produce the same arrangement every time.

**Size limit**

- **FR-012**: At most **200** entities MUST be visible at once, including the focus, connectors, expansions and blocking-path entities. When more qualify, the explorer MUST show the 200 with the highest priority, in this order:
  1. the focus;
  2. entities on the first-ranked blocking path, then other blocking paths in rank order (when highlighting is on);
  3. neighborhood and expansion entities by distance, then by the strength of their connection (feature 003, FR-016), then entity type, display name and identifier.
- **FR-013**: When entities are left out, the explorer MUST say how many, in the form "Showing 200 of N entities — M more. Refine filters, reduce the step limit, or choose a direction." To bound work, the system MAY stop counting after exploring 10,000 entities, in which case the message MUST state a lower bound ("more than 10,000") and the view MUST be labeled truncated. The result MUST never be silently incomplete.

**Interaction**

- **FR-014**: Users MUST be able to zoom, pan, and reset the view to fit all visible entities.
- **FR-015**: Users MUST be able to select a node or a relationship in the graph or in the list. The selection MUST be highlighted in both, and the side panel MUST show its details.
- **FR-016**: Users MUST be able to **expand** any visible non-focus node: its direct neighbors that pass the active direction and filters are added to the view and marked as added by that expansion. Users MUST be able to **collapse** an expanded node: the entities added by that expansion are removed unless they remain visible for another reason (neighborhood, another expansion, or a highlighted blocking path). Expansions are subject to FR-012.
- **FR-017**: Users MUST be able to turn on **focus mode** for a selected node: that node, its direct relationships and direct neighbors stay fully visible, and every other element is dimmed but stays in place. Turning it off restores the view.
- **FR-018**: Every action available on the graph (select, expand, collapse, focus mode, Explore from here, open Entity 360) MUST also be available from the list, and the list MUST be usable with the keyboard alone.

**Blocker highlighting**

- **FR-019**: Users MUST be able to turn **Highlight blockers** on and off. When on, the explorer MUST obtain the focus entity's blockers from feature 003's blocker tracing, with its default depth and no extra filters, and highlight every returned blocking path, in rank order. The direct blockers and the deepest blockers MUST be marked distinctly. Elements not on any blocking path MUST be dimmed.
- **FR-020**: Entities and relationships on a blocking path that are not already visible MUST be added to the view and marked as added by a blocking path. Turning highlighting off MUST remove them unless they remain visible for another reason.
- **FR-021**: Users MUST be able to select a single blocking path, which then is the only one highlighted.
- **FR-022**: While highlighting is on, the text panel MUST show feature 003's blocker summary and each path's plain-language explanation, unchanged, together with its labels for non-SOURCE hops, unknown states, cycles, depth limits and truncation.

**Side panel**

- **FR-023**: Selecting a node MUST open a side panel showing:
  - the entity's type, display name and identifier;
  - its current state, with the reporting source system and observation time, and each source's latest state when they disagree;
  - its source systems and source records (feature 002), each with source system, source identifier and observation time;
  - **Blocked by**: its direct blockers, with their states, from feature 003's blocker tracing; or a statement that none were found;
  - **Blocks**: the entities that directly depend on it through REQUIRES, DEPENDS_ON or BLOCKS, each with its state and the relationship's origin and confidence, when the selected entity is unsatisfied or indeterminate (feature 003, FR-006). When it is satisfied, the panel states that it is not blocking anything;
  - a link to its Entity 360 page, and an "Explore from here" action.
- **FR-024**: Selecting a relationship MUST open a side panel showing the relationship as recorded (from, type, to), its effective origin and confidence, and every assertion with its origin, confidence, basis where present, source system, source identifier and observation time.
- **FR-025**: Every entity named in the side panel or the text panel MUST be selectable, and MUST offer a link to its Entity 360 page.

**Paired text view**

- **FR-026**: The graph MUST always be shown together with a list of the same visible entities and relationships. It MUST NOT be possible to show the graph without the list. The list MUST:
  - group entities by distance from the focus, and order them as in FR-012;
  - show, per entity, its type, display name, current state, distance, conflict and unknown-state markers, and why it is visible (neighborhood, connector, expansion, blocking path);
  - show, per relationship, its recorded from, type and to, and its origin and confidence as text.
- **FR-027**: The header MUST state, in words, the focus entity, direction, step limit, active filters, the number of visible entities and relationships, any left-out count (FR-013), and when the view was loaded.

**Data access, access control and behavior**

- **FR-028**: The neighborhood MUST be obtained through the central graph-reading capability (feature 003, FR-022), with the step limit, direction, filters and the 200-entity limit applied by that capability. No other part of the system MAY traverse relationships. Blockers, upstream and downstream MUST reuse feature 003's existing tracing capabilities rather than reimplement them.
- **FR-029**: A neighborhood result for the same data and settings MUST be identical in content and order, except for its load time.
- **FR-030**: All signed-in roles MUST be able to use the explorer. Unauthenticated users MUST be refused. A nonexistent focus entity MUST be refused as not found. Invalid settings MUST be refused with a validation error naming the field and allowed values.
- **FR-031**: The explorer MUST be read-only. It changes no data, so it writes no data-change audit entries.
- **FR-032**: The explorer MUST NOT show risk highlighting, impact highlighting or history inspection, not even as disabled controls. Those arrive with their own features.

**Shared contracts and tests**

- **FR-033**: Every new request and response payload MUST be defined once as a shared, validated schema used by both the backend and the web app. Every new endpoint MUST have end-to-end tests for its success path, authentication failure and validation failure.
- **FR-034**: Automated tests MUST cover at least:
  - every acceptance scenario in Stories 1 to 4 against the seeded reference scenario;
  - agreement of Upstream only and Downstream only with feature 003's queries;
  - the step limit at 1, 2 and 4;
  - each filter, including connector behavior;
  - expand and collapse, including entities visible for several reasons;
  - the 200-entity limit and its priority order;
  - cycles, parallel relationships and multi-source relationships;
  - determinism of the result and the layout.

### Key Entities

- **Explorer View**: the user's current settings: focus entity, direction, step limit, entity-type filter, relationship-type filter, blocker-highlighting setting. It is not stored; it lives in the page address. Expansions, selection and focus mode are session-only.
- **Neighborhood**: the entities and relationships within the step limit of the focus under the view's settings. Each entity carries its distance and the reason it is visible. It also carries the total count, the left-out count, a truncation flag and its load time.
- **Expansion**: the set of entities added by expanding one node. It is used to work out what collapsing that node removes.
- **Visible Node**: an entity in the view, with its type, name, current state, conflict and unknown-state markers, distance, and the reasons it is visible (neighborhood, connector, expansion, blocking path).
- **Visible Relationship**: a relationship in the view, as recorded, with its effective origin and confidence and its assertions (feature 003's hop data).
- **Blocker Highlight**: the feature 003 blocker result for the focus entity: ranked paths, direct and deepest blockers, summary and explanations, mapped onto the view.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Starting from Shipment SHP-77120's Entity 360 page, a signed-in user can open the explorer, highlight blockers and select the missing Budget code to see its evidence in under 30 seconds.
- **SC-002**: On the seeded reference scenario, 100% of the acceptance scenarios in Stories 1 to 3 pass in automated tests. The highlighted blocking paths match feature 003's blocker results exactly.
- **SC-003**: In a data store with 50,000 entities and at least 150,000 relationships, the explorer shows the default neighborhood of any entity, up to 200 entities, in under 2 seconds at the 95th percentile over 20 runs. An expansion appears in under 1 second.
- **SC-004**: With 200 visible entities on a standard laptop (1366×768 or larger), panning, zooming and selecting respond without perceptible lag (each interaction visibly completes within 100 ms).
- **SC-005**: In 100% of explorer views, the list and the graph contain the same entities and relationships, verified by automated tests over the seeded scenario and generated graphs.
- **SC-006**: 100% of drawn relationships carry a visible origin style and confidence emphasis, and 100% of non-SOURCE relationships are labeled as inferred or manual in the list and the side panel, verified by automated tests over the full seed.
- **SC-007**: No view ever shows more than 200 entities, and every view with more qualifying entities shows the left-out count, verified by automated tests over generated high-fan-out graphs.
- **SC-008**: 100 consecutive loads of the same view against unchanged data produce identical entities, relationships, order and arrangement.

## Assumptions

- **Scope boundaries**: Risk highlighting, impact highlighting, dependency-path visualization beyond blocker paths, and history inspection (§22) are out of scope. They belong to the risk (later), impact (006) and timeline features. Saving an explorer view belongs to Investigations.
- **Neighborhood meaning**: "Relevant neighborhood" in the all-directions view means every entity within the step limit, ignoring relationship direction, so siblings such as the other orders on the same shipment are shown. Upstream only and Downstream only follow dependency direction at every step, so they match feature 003 exactly.
- **Step limit range**: 1 to 4, default 2. Larger neighborhoods would rarely stay under 200 entities, and deeper questions are answered by feature 003's tracing (up to 10) and by blocker highlighting, which may reach beyond the step limit.
- **Blocker highlighting scope**: Highlighting applies to the focus entity only, at feature 003's default depth (6). To highlight another entity's blockers, the user re-centers on it. Any selected node's direct blockers are always shown in its side panel.
- **"Blocks" meaning**: "Blocks" lists the direct dependents through the three blocker relationship types, and only when the entity is itself unsatisfied or indeterminate, consistent with feature 003's blocker semantics. A satisfied entity is not blocking anything.
- **Entity-type filtering**: Hiding intermediate entities would leave shown entities disconnected from the focus, so they stay as dimmed connectors, consistent with feature 003's "filter what is reported, not what is traversed" rule.
- **Shareable state**: The page address carries the view's settings, not expansions, selection or focus mode. These are transient exploration steps and could make links very long. A colleague opening the link sees the same neighborhood and highlighting.
- **Visible-node limit**: 200 is a hard cap on everything visible at once, matching the user's stated usability target. The priority rule keeps the most relevant context, in line with §22 ("prioritize relevant context rather than trying to render everything").
- **Exploration limit**: The neighborhood reuses feature 003's 10,000-entity exploration limit for counting.
- **Layout**: Upstream-to-one-side, downstream-to-the-other layered layout matches how users read dependency chains. A free-form or force-directed layout is not required.
- **Existing foundation**: Sign-in, roles, error format, shared-schema conventions, the entity data model, the reference seed, source records, one-hop neighbor lookup, and feature 003's upstream, downstream and blocker tracing, including dependency directions, path ranking and explanation text, are reused unchanged. A new neighborhood capability is added to the central graph-reading capability only because none of the existing ones returns an all-directions, size-limited neighborhood.
- **Branch base**: This feature builds on feature 003, which is not yet merged into main.
