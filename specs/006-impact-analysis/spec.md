# Feature Specification: Impact Analysis

**Feature Branch**: `006-impact-analysis`
**Created**: 2026-10-06
**Status**: Draft
**Input**: User description: "Impact analysis (Product Overview §12, §40, §42). Given any entity (Supplier, Warehouse, Payment, blocked Order…), compute what is affected downstream: direct impact (1 hop) vs indirect (further hops), grouped by entity type with counts (products, purchase orders, customer orders, customers, shipments, SLA commitments) and financial exposure (sum of affected order values, no double counting when multiple paths reach the same order). Distinguish current impact (already blocked/delayed) from potential impact (affected if the issue continues). Every number drills down to the exact entity list and the paths that produced them. Traversal only through GraphRepository with depth limit and cycle guard; results deterministic. Add an Impact panel to Entity 360. Seed data must make "Supplier X unavailable" produce non-trivial results. Performance: impact for one entity over a 50k-entity graph in under 2 seconds."

## Overview

Feature 003 answers "What depends on this?" with a list of every downstream entity and one path to each. Feature 005 answers "Why is this stuck?". Neither answers the manager's question in §12, §40 and §42: **"If this is a problem, what does it affect, and how much is at stake?"**

This feature adds **impact analysis**. For any entity, OpsGraph computes what is affected downstream and presents it as business numbers:

> **Fabrikam Components** is SUSPENDED.
> Currently affected: 3 purchase orders, 6 customer orders, 2 shipments, 2 SLA commitments, 3 customers. **51,250.00 USD** exposed.
> Potentially affected if it continues: 4 products, 2 purchase orders, 6 customer orders, 1 shipment, 1 SLA commitment, 1 more customer. **32,750.00 USD** more exposed.
> Total exposure: **84,000.00 USD** across 12 customer orders.

The numbers are split along two independent axes:

- **Direct vs indirect**: one step from the analyzed entity, or further.
- **Current vs potential**: already impaired through an unbroken chain of impaired entities from the analyzed entity, or only reachable and so affected if the issue continues.

Financial exposure is the sum of affected customer-order values. Each order is counted once, however many paths reach it.

Every number is a door, not a conclusion. Selecting it lists the exact entities behind it and the paths that connect each one to the analyzed entity, with each hop's origin and confidence. Numbers that rest only on inferred or manually recorded links say so.

This covers the Product Overview §12 dimensions as follows:
- operational impact: products, purchase orders, customer orders, shipments and other affected entities;
- customer impact: customers;
- SLA impact: SLA commitments;
- financial impact: exposure;
- direct and indirect impact: the first axis;
- current and predicted impact: the second axis, where "predicted" is called **potential**.

To make the supplier example of §40 real, this feature adds a **Purchase order** entity type and a second seed dataset in which a supplier becomes unavailable. The §39 reference dataset is unchanged.

Impact is computed on demand, read-only, and with no probabilistic or AI component. It does **not** deliver what-if simulation, time-based predictions, risk scoring, prioritization advice, alternative suppliers or mitigations, exceptions or investigations. Those are later features.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - "What is affected if Supplier X is unavailable?" (Priority: P1)

An Operations Manager hears that Fabrikam Components cannot deliver. They open the supplier's Entity 360 page. An **Impact** section shows, without any further action:

- the summary sentences above;
- a table of affected entities by category, with direct and indirect, current and potential counts;
- the financial exposure, split into current and potential.

| Category | Total | Direct | Indirect | Current | Potential |
|---|---|---|---|---|---|
| Products | 4 | 4 | 0 | 0 | 4 |
| Purchase orders | 5 | 5 | 0 | 3 | 2 |
| Customer orders | 12 | 0 | 12 | 6 | 6 |
| Customers | 4 | 0 | 4 | 3 | 1 |
| Shipments | 3 | 0 | 3 | 2 | 1 |
| SLA commitments | 3 | 0 | 3 | 2 | 1 |
| **Exposure** | **84,000.00 USD** | — | — | **51,250.00 USD** | **32,750.00 USD** |

Below the table, the section states what was **not counted** and why:
- 1 purchase order and 1 customer order are already completed;
- 1 product, 1 customer order, 1 SLA commitment and 2,400.00 USD of the potential exposure are reached only through inferred links.

**Why this priority**: "What is affected?" is one of the two core product questions (§61, §65), and §40 calls supplier failure the demonstration of dependency-aware analysis. Without these numbers, a manager cannot judge how severe a problem is.

**Independent Test**: Seed both datasets. Sign in as an Operations Manager, open Fabrikam Components, and compare the Impact section with scenarios 1 to 5. Repeat the analysis 100 times through the service interface and confirm identical results.

**Acceptance Scenarios**:

All scenarios use the supplier-failure dataset (FR-030) at the default depth.

1. **Given** the supplier-failure dataset, **When** impact is requested for Fabrikam Components, **Then** the counts are exactly those in the table above.
2. **Given** the same analysis, **When** its exposure is shown, **Then**:
   - total exposure is **84,000.00 USD** from 12 customer orders;
   - current exposure is 51,250.00 USD and potential exposure is 32,750.00 USD;
   - at least 3 of those orders are reached by more than one path, and each is counted once. Adding up exposure path by path would give a larger figure, and the result does not do that.
3. **Given** the same analysis, **When** excluded entities are shown, **Then**:
   - the completed purchase order and the completed customer order are listed as "already completed, not counted";
   - the completed order's value is not in any exposure figure.
4. **Given** the same analysis, **When** inference is shown, **Then**:
   - the product linked to the supplier only by an inferred relationship (INFERRED / LOW) is counted and labeled "reached only through inferred links";
   - so is the customer order that contains only that product, and its value (2,400.00 USD) is reported as the part of potential exposure that rests only on inferred links;
   - the SLA commitment linked to its shipment only by an inferred relationship is labeled the same way.
5. **Given** the same analysis, **When** the control entities are checked, **Then** none of them is counted: the second supplier's own product, the customer with no affected orders, and its order, shipment and SLA.
6. **Given** any impact request, **When** it is repeated against unchanged data with the same query, **Then** every count, figure, list, order and sentence is identical, except the computed time.

---

### User Story 2 - Drill down from any number to the entities and paths behind it (Priority: P1)

The manager selects **6** in the "Customer orders / Current" cell. A list opens with exactly those 6 orders. Each row shows:
- the order's display name, state and value;
- the customer who placed it;
- its distance in steps;
- its **primary path** from Fabrikam Components, for example Fabrikam Components → (SUPPLIED_BY) a DELAYED purchase order → (DEPENDS_ON) the WAITING order. Each hop shows its origin and confidence.

An order reached in several ways also shows its other paths and how many there are, with a note that it is counted once in exposure.

They then select the exposure figure **51,250.00 USD**. The list shows the 6 orders whose values make up that figure, ordered by value, with a total row that matches the figure exactly. Selecting **3** under "Customers / Current" lists the 3 customers, ordered by their own exposure, each with the affected orders and SLA commitments that make them affected.

**Why this priority**: The description requires that every number drill down to its entities and paths. Explainability is a constitutional principle (III). A number that cannot be opened is an opaque score.

**Independent Test**: For the Fabrikam Components analysis, open every non-zero cell of the table and both exposure figures. Check that each list's length equals its number, that exposure lists add up to their figures, and that every row has a path that starts at the analyzed entity and ends at that row's entity.

**Acceptance Scenarios**:

1. **Given** any cell of the impact table, **When** it is opened, **Then** the list contains exactly as many entities as the cell's number. The union of a category's Current and Potential lists equals its Total list, and so does the union of its Direct and Indirect lists, with no entity in both lists of a pair.
2. **Given** any listed entity other than a customer, **When** it is shown, **Then**:
   - it has a primary path (FR-014) from the analyzed entity, with every hop's relationship as recorded, direction, origin, confidence, and the state of the entity reached;
   - when the entity is current, its primary path consists entirely of impaired entities (FR-007).
3. **Given** a listed customer, **When** it is shown, **Then** it names the affected orders and SLA commitments that make it affected, each with its own primary path, and the relationship that links the customer to them.
4. **Given** an exposure figure, **When** it is opened, **Then** it lists every contributing order with its value and currency, and the values add up exactly to the figure.
5. **Given** an order reached by several paths, **When** it is shown, **Then** it lists its other distinct paths (up to the limit in FR-022), states whether more exist, and states that it is counted once.
6. **Given** a list longer than one page, **When** it is shown, **Then** it is paginated in the fixed order of FR-018, and every page states the list's total.

---

### User Story 3 - Impact for any entity: direct vs indirect, current vs potential (Priority: P2)

An Operations Analyst uses impact analysis on entities of the §39 reference scenario.

- On **Payment PAY-88213** (PENDING), almost everything is **currently** affected. The payment is already holding up the order, the shipment and the 16 orders consolidated on it.
- On **Warehouse WH-EAST-02** (ACTIVE), the same orders appear only as **potential** impact. They are impaired, but not because of the warehouse. The analysis does not blame the warehouse for them.

**Why this priority**: Stories 1 and 2 prove the feature on the dataset built for it. This story proves it on the reference scenario that the whole product is tested against, across different kinds of starting entity.

**Independent Test**: Seed the reference scenario and run impact analysis at the default depth for each entity in scenarios 1 to 8. Compare counts, exposure and current/potential splits.

**Acceptance Scenarios**:

The values below follow from the §39 dataset and FR-003 to FR-012. "The 16 orders" are the orders on Shipment SHP-77120 other than #18492. "The 4 customers" are Acme Corp, Globex Retail, Initech Supplies and Umbrella Logistics.

1. **Given** **Payment PAY-88213** (PENDING), **When** impact is requested, **Then**:
   - **direct**: Order #18492 (BLOCKED) and Shipment SHP-77120 (DELAYED);
   - **indirect**: Invoice INV-55120, the 16 orders and the 4 delivery SLAs, plus the 4 customers;
   - **current**: everything above except Umbrella Logistics delivery SLA (ACTIVE), which is potential;
   - **exposure**: 31,400.00 USD from 17 orders, all current.

   The shipment's direct link is the manually recorded "PAY-88213 BLOCKS SHP-77120" (MANUAL / MEDIUM). Its primary path is still the 2-hop SOURCE / HIGH path through Order #18492, under the ranking in FR-014.
2. **Given** the same analysis, **When** each of the 16 orders is shown, **Then** it is reached by 2 distinct paths (through Order #18492, and through the BLOCKS relationship), is listed once, and contributes its value once.
3. **Given** **Budget code for Order #18492** (MISSING), **When** impact is requested, **Then**:
   - the 25 entities reached are exactly those in feature 003, Story 2, scenario 1;
   - **direct**: Finance approval APR-2291 only;
   - customers: the 4 customers;
   - **current**: everything except Umbrella Logistics delivery SLA (ACTIVE), which is potential;
   - exposure: 31,400.00 USD, all current.
4. **Given** **Order #18492** (BLOCKED), **When** impact is requested, **Then**:
   - **direct**: Invoice INV-55120 and Shipment SHP-77120;
   - **indirect**: the 16 orders, the 4 delivery SLAs and the 4 customers;
   - **current**: everything except Umbrella Logistics delivery SLA (ACTIVE), which is potential;
   - exposure: **18,920.00 USD**, all current. The order's own value, 12,480.00 USD, is shown separately as the analyzed entity's own value and is not part of the exposure (FR-011).
5. **Given** **Warehouse WH-EAST-02** (ACTIVE), **When** impact is requested, **Then**:
   - **direct**: the 17 affected orders and Shipment SHP-77120;
   - **indirect**: Invoice INV-55120, the 4 delivery SLAs and the 4 customers;
   - **current**: none;
   - **exposure**: 31,400.00 USD, all potential.

   Every impaired counted entity is flagged "impaired for another reason" (FR-009): the 17 orders, the shipment, the invoice and the 3 at-risk SLAs.
6. **Given** **Warehouse WH-WEST-01** (ACTIVE), **When** impact is requested, **Then**:
   - **counted**: Order #18531 and Shipment SHP-77125 (both direct, potential), and Initech Supplies;
   - **not counted**: Order #18530 and Shipment SHP-77098, as already completed;
   - **exposure**: 875.00 USD, all potential. The 2,340.00 USD of Order #18530 is not counted.
7. **Given** **Supplier Northwind Steel** (ACTIVE, SOURCE / HIGH link to Product PRD-5521), **When** impact is requested, **Then**:
   - **direct**: Product PRD-5521;
   - **indirect**: the 17 orders, Shipment SHP-77120, Invoice INV-55120, the 4 delivery SLAs and the 4 customers;
   - everything is potential;
   - **exposure**: 31,400.00 USD, all potential.

   The 4 SLAs are labeled as reached only through an inferred link (SLA DEPENDS_ON Shipment, INFERRED / MEDIUM).
8. **Given** **Supplier Contoso Metals** (ACTIVE, linked to Product PRD-5521 only by an INFERRED / LOW relationship), **When** impact is requested, **Then** the counts equal those in scenario 7. Every counted entity and the whole 31,400.00 USD are labeled as reached only through inferred links, and the summary says so in its first sentence.
9. **Given** Northwind Steel at **depth 3**, **When** impact is requested, **Then**:
   - only Product PRD-5521, Order #18492, Shipment SHP-77120, Invoice INV-55120 and Acme Corp are counted;
   - exposure is 12,480.00 USD;
   - the result states that impact continues beyond depth 3, and the summary says the counts are a lower bound.

---

### User Story 4 - Impact on the Entity 360 page (Priority: P2)

Every Entity 360 page gains an **Impact** section after Blockers and before Dependencies. When an entity affects something, the section shows the summary, the category table and the exposure, with the Current column first. Each number can be opened in place as in Story 2. The analyst can change the depth. The page address reflects the depth and any opened list, so a copied link shows a colleague the same view. When an entity affects nothing, the section is a single line.

**Why this priority**: The Entity 360 page is where users meet every analysis (features 003 and 005). The section is the delivery surface of Stories 1 to 3, but the analysis is valuable through the service interface on its own.

**Independent Test**: Open Fabrikam Components, Payment PAY-88213, Warehouse WH-WEST-01 and Invoice INV-55120 as each role. Check the section's position, content, single-line form, drill-down and copied-link behavior against the scenarios below.

**Acceptance Scenarios**:

1. **Given** any entity, **When** its Entity 360 page is opened, **Then** the sections appear in this order:
   1. Identity
   2. Current state
   3. Root cause
   4. Blockers
   5. **Impact**
   6. Dependencies
   7. Relationships
   8. Timeline
   9. Source records
2. **Given** Fabrikam Components, **When** its page is opened at 1366×768, **Then** the Impact summary sentences and the category table are visible after at most one scroll.
3. **Given** an entity that nothing depends on (for example Invoice INV-55120), **When** its page is opened, **Then** the Impact section is a single line stating that nothing is affected within the searched depth, naming that depth.
4. **Given** a link copied with a chosen depth and an opened list, **When** another signed-in user opens it, **Then** they see the same depth, the same opened list and the same results.
5. **Given** any entity named in the Impact section, **When** it is selected, **Then** the user navigates to its Entity 360 page.
6. **Given** a user who is not signed in, **When** they request an impact result or a drill-down list, **Then** access is refused. **Given** any signed-in role, **When** they use impact analysis, **Then** it works and changes no data.

---

### Edge Cases

- **Analyzed entity is not impaired** (for example an ACTIVE warehouse or supplier): nothing is current. Everything reachable is potential. The summary reads "If ‹entity› became unavailable…" instead of "Currently affected…" (FR-021).
- **Analyzed entity is UNKNOWN**: nothing is current, because the problem is not confirmed. Everything reachable is potential, and the summary says the entity's state is unknown.
- **UNKNOWN entity inside a chain**: it is counted where it falls, as potential, labeled "state unknown". A chain through it is not live, so entities behind it are current only through another live path.
- **Terminal entities** (COMPLETED or CANCELLED): they are listed under "not counted" with their state, and traversal does not continue through them. An entity reachable both through a terminal entity and another way is counted through the other way.
- **Impaired for another reason**: an impaired entity with no live path from the analyzed entity is potential and flagged as impaired for another reason (Story 3, scenario 5).
- **Several paths to one entity**: counted once, in one direct/indirect bucket (by shortest distance) and one current/potential bucket (current if any live path exists). Its value is added once.
- **Shortest path is weaker than another path**: the distance comes from the shortest path, but the primary path follows the ranking in FR-014. The entity can be direct while its primary path is longer (Story 3, scenario 1). The direct link is always listed among its paths.
- **Analyzed entity is a customer order**: it is never in its own counts or exposure. Its own value is shown separately (FR-011).
- **Analyzed entity is a customer**: it is never counted as an affected customer of itself.
- **Order values that disagree between sources**: the order's current value is used, all source values are shown on the order, and exposure also states the lowest and highest totals the disagreeing values would give (FR-013).
- **Several currencies**: exposure is reported per currency and never converted or added across currencies.
- **Order without a recorded value**: it is counted and listed as "value unknown". It is left out of the sum, and the exposure states how many orders it excludes.
- **Cycles**: an entity already on a path is not revisited. Traversal terminates, and skipped cycle-closing relationships are listed (feature 003, FR-010).
- **Depth limit**: when impact continues beyond the depth, the result says so, and every count and exposure figure is stated as a lower bound ("at least").
- **Exploration limit**: when traversal stops at the limit in FR-022, the result is flagged as truncated, and every count and exposure figure is stated as a lower bound.
- **RELATES_TO** relationships carry no dependency meaning and are never followed (feature 003, FR-005).
- **Invalid depth or unknown list selector**: refused with a validation error naming the field and the allowed values. A nonexistent entity is refused as not found.
- **Data changes between the summary and a drill-down**: each result states its computed time. A drill-down is computed against current data. If its total differs from the number the user selected, the list says the data has changed and offers a refresh.

## Requirements *(mandatory)*

### Functional Requirements

**Scope and traversal**

- **FR-001**: System MUST compute an impact analysis for any entity on request: every entity that depends on it, directly or transitively, following the dependency directions of feature 003, FR-002. All relationship types except RELATES_TO are followed. The traversal follows feature 003's downstream rules on depth (default 6, minimum 1, maximum 10, invalid values refused), cycle handling and explicit paths, plus the terminal-entity rule in FR-004.
- **FR-002**: Multi-hop traversal for impact, including customer attribution (FR-010), MUST be performed only by the central graph-reading capability (feature 003, FR-022). Every traversal MUST enforce the depth limit and the cycle guard. No other part of the system MAY traverse relationships.

**Classification**

- **FR-003**: Each reached entity MUST be classified by its current state (feature 002, FR-015):
  - **impaired**: PENDING, WAITING, BLOCKED, MISSING, DELAYED, FAILED, SUSPENDED or AT_RISK;
  - **unimpaired**: ACTIVE;
  - **terminal**: COMPLETED or CANCELLED;
  - **indeterminate**: UNKNOWN.
- **FR-004**: Terminal entities MUST NOT be counted, and traversal MUST NOT continue through them. They MUST be listed as "not counted", with their state, distance and primary path.
- **FR-005**: Each counted entity MUST be **direct** if its shortest distance from the analyzed entity is 1, otherwise **indirect**.
- **FR-006**: A **live path** is a path in which the analyzed entity and every entity after it are impaired.
- **FR-007**: A counted entity MUST be **current** if at least one live path reaches it within the depth, otherwise **potential**. When the analyzed entity is not impaired, every counted entity is potential.
- **FR-008**: An indeterminate entity MUST be counted as potential and labeled "state unknown". It MUST NOT be presented as currently affected.
- **FR-009**: A potential entity that is itself impaired MUST be flagged "impaired for another reason". The flag says that its state is not explained by a live path from the analyzed entity.
- **FR-010**: **Customers** MUST be counted by attribution, because customers are never downstream:
  - a customer is affected if it PLACED a counted customer order, or HAS the contract that DEFINES a counted SLA commitment;
  - a customer is current if any order or SLA commitment attributed to it is current, otherwise potential;
  - affected customers are counted as indirect;
  - attribution steps MUST NOT count toward the depth limit.
- **FR-011**: The analyzed entity MUST NOT appear in its own counts, lists or exposure. If it has a value (for example a customer order), that value MUST be shown separately as "the analyzed entity's own value".

**Grouping, counts and exposure**

- **FR-012**: Counted entities MUST be grouped by entity type. These **headline categories** MUST always appear, in this order, even when zero:
  1. Products
  2. Purchase orders
  3. Customer orders (entity type Order)
  4. Customers
  5. Shipments
  6. SLA commitments (entity type SLA)

  Any other affected type (for example Invoice, Payment, Approval) MUST follow under "Other affected entities", by type name, only when non-zero. Each category MUST report Total, Direct, Indirect, Current and Potential counts, plus the number of entities reached only through inferred or manual links (FR-015) and the number flagged "state unknown".
- **FR-013**: **Financial exposure** MUST be the sum of the values of the counted customer orders, each order counted once however many paths reach it. It MUST:
  - be reported in total, current and potential;
  - be computed separately per currency, with no conversion;
  - leave out terminal orders, the analyzed entity's own value and orders without a recorded value, and state how many orders were left out and why;
  - use each order's current value. When an order's source systems disagree on its value, the order MUST show every source's value, and exposure MUST also state the lowest and highest totals those values allow. The result MUST never silently pick one value.
  - not include values of other entity types (payments, invoices, purchase orders), because they would count the same money twice.

**Paths and evidence**

- **FR-014**: Every counted and not-counted entity MUST carry a **primary path** from the analyzed entity, with every hop as in feature 003, FR-012. The primary path is chosen as follows:
  - for a current entity, the highest-ranked **live** path under feature 003, FR-016;
  - otherwise, the highest-ranked path.

  The distance shown is the shortest-path distance (FR-005). When the shortest path is not the primary path, the shortest path MUST be listed too.
- **FR-015**: Each counted entity MUST state whether at least one of its paths consists only of SOURCE hops. Entities with no such path MUST be labeled "reached only through inferred or manual links", with the weakest origin and confidence on their primary path. A customer gets this label when every order and SLA commitment attributed to it has it. Exposure MUST state how much of each figure comes from such orders. Summary text MUST NOT state these entities as fact.
- **FR-016**: Each counted entity MUST state the number of distinct paths found to it within the limits. Its alternative paths MUST be listable as in FR-022.

**Drill-down**

- **FR-017**: Every number in the result MUST be openable as a list of the exact entities that produced it. This covers every category cell, every exposure figure, every "not counted" count, every "reached only through inferred or manual links" count and every "state unknown" count. A list's length MUST equal its number, and an exposure list's values MUST add up exactly to its figure.
- **FR-018**: Lists MUST be ordered deterministically:
  - customer orders: by value, highest first, then display name, then identifier;
  - customers: by attributed exposure, highest first, then display name, then identifier;
  - all other entities: current before potential, then distance, then display name, then identifier.
- **FR-019**: Each listed entity MUST show:
  - its identifier, type, display name, current state with source system and observation time, and its classification;
  - its primary path, distance and number of paths;
  - for orders: value, currency and customer;
  - for customers: the attributed orders and SLA commitments, each with its primary path and the attributing relationship;
  - any flags from FR-008, FR-009 and FR-015.

**Determinism, explanation and limits**

- **FR-020**: Given identical data and an identical query, every impact result and list MUST be identical in content and order, except the computed time. Results MUST be computed on demand and not stored.
- **FR-021**: Every result MUST begin with plain-language summary sentences, generated deterministically from the result data alone:
  - the analyzed entity and its state;
  - when it is impaired, "Currently affected: …" with the non-zero current counts and current exposure, then "Potentially affected if it continues: …" with the non-zero potential counts and exposure;
  - when it is not impaired, "If ‹entity› became unavailable: …" with the potential counts and exposure;
  - a sentence for each applicable condition: inferred or manual links, "state unknown" entities, entities left out, value disagreements, and depth or exploration limits ("at least").
- **FR-022**: Every result MUST echo its query (analyzed entity, depth) and state its computed time and whether it was limited by depth or truncated by exploration. Limits:
  - impact traversal MUST stop and flag the result as truncated after exploring 10,000 entities;
  - each entity lists at most 20 alternative paths and states whether more exist;
  - drill-down lists MUST be paginated, with a default page size of 50 and a maximum of 200.

**Purchase orders**

- **FR-023**: The entity vocabulary MUST gain a **Purchase order** type (PurchaseOrder): a replenishment order issued to a supplier for products. It MUST be importable, listable, searchable and filterable like every other type, everywhere entity types are offered.
- **FR-024**: These relationships MUST become valid, with the dependency directions of feature 003, FR-002 unchanged:
  - Purchase order SUPPLIED_BY Supplier: the purchase order relies on the supplier;
  - Purchase order CONTAINS Product: the purchase order relies on the product;
  - Order DEPENDS_ON Purchase order: the customer order relies on the inbound stock (already valid, since DEPENDS_ON accepts any types).
- **FR-025**: Purchase-order values MUST NOT be part of financial exposure (FR-013).

**Access and Entity 360**

- **FR-026**: All signed-in roles MUST be able to request impact analyses and drill-down lists. Unauthenticated callers MUST be refused. Impact analysis MUST be read-only and write no data-change audit entries.
- **FR-027**: The Entity 360 page MUST show an **Impact** section after Blockers and before Dependencies. It shows:
  - the FR-021 summary;
  - the category table with the Current column first;
  - the exposure figures and the "not counted" line;
  - a depth control.

  Every number opens its drill-down list in place.
- **FR-028**: When nothing is affected within the depth, the Impact section MUST be a single line naming the depth. The chosen depth and any opened list MUST be reflected in the page address. Every entity named in the section MUST link to its Entity 360 page.
- **FR-029**: The Impact section MUST present text, tables and lists. This feature MUST NOT add a graph view. Any later graph view of impact MUST be accompanied by them.

**Seed data**

- **FR-030**: The seed MUST add a **supplier-failure dataset** (Product Overview §40). It is entirely disconnected from the §39 dataset, which MUST remain unchanged, so that every earlier acceptance result still holds. Analyzed at the default depth, its supplier, **Fabrikam Components** (state SUSPENDED, "unavailable" in its source), MUST produce exactly the results in Story 1. Its content:
  - **Products**: 4 ACTIVE products depending on the supplier. 3 are linked by SOURCE / HIGH relationships. 1 is linked only by an INFERRED / LOW relationship and is also supplied by the control supplier.
  - **Purchase orders**: 6 issued to the supplier. 3 are DELAYED, 2 ACTIVE and 1 COMPLETED.
  - **Customer orders**: 13 reachable. Of these:
    - 6 are WAITING on a delayed purchase order;
    - 6 are potential, including one PENDING order whose only path runs through an ACTIVE purchase order (FR-009), and one order that contains only the inferred-link product, valued at 2,400.00 USD;
    - 1 is COMPLETED;
    - at least 3 are reachable by more than one path.

    Values: current orders total 51,250.00 USD, potential orders 32,750.00 USD, all in USD.
  - **Shipments**: 3 that depend on affected orders. The 2 DELAYED ones depend on current orders. The ACTIVE one depends only on potential orders.
  - **SLA commitments**: 3 depending on those shipments. 2 are AT_RISK and 1 ACTIVE. One of the AT_RISK ones is linked only by an INFERRED / MEDIUM relationship.
  - **Customers**: 4 who placed the affected orders, with contracts defining the SLA commitments. 3 have at least one current order. 1 has only potential orders and an ACTIVE SLA commitment.
  - **Control entities**, which MUST NOT be reached: a second, ACTIVE supplier with its own product and purchase order, and a fifth customer whose order, shipment and SLA depend only on that product.
  - **Provenance**: every row carries source system, source identifier and observation time like the §39 rows, and the dataset includes operational events for the supplier outage and the purchase-order delays.

  The exact rows MUST be published with the plan, alongside the expected results.
- **FR-031**: A unit test over the dataset document MUST verify the Story 1 numbers independently of the production traversal. This follows the §39 dataset's dependency check in feature 002.

**Shared contracts and tests**

- **FR-032**: Every new request and response payload MUST be defined once as a shared, validated schema used by the backend and the web app. Every new endpoint MUST have end-to-end tests for its success path, authentication failure and validation failure.
- **FR-033**: Automated tests MUST cover at least:
  - every classification case in FR-003 to FR-009: terminal pass-through blocked, live and broken chains, UNKNOWN in a chain and as the analyzed entity, unimpaired analyzed entity;
  - direct vs indirect when the shortest path is weaker than the primary path;
  - no double counting with diamond-shaped and multi-path graphs;
  - customer attribution through orders and through SLA commitments;
  - exposure with several currencies, missing values and disagreeing source values;
  - cycles, depth 1, the default and 10, and truncation;
  - every acceptance scenario in Stories 1 to 3 against the seeded datasets;
  - for every list in FR-017, that its length and sums match their numbers.

### Key Entities

- **Impact Query**: a request for one analyzed entity and a depth. Not stored. Echoed in every result.
- **Impact Result**: the echoed query and computed time, limit and truncation flags, the summary sentences, the category table, the exposure figures, the not-counted summary, the analyzed entity's own value where present, and the skipped cycle-closing relationships. Not stored.
- **Impact Category**: one entity type's counts: Total, Direct, Indirect, Current and Potential, reached only through inferred or manual links, and state unknown.
- **Affected Entity**: one counted or not-counted entity. It has a classification (current, potential, or not counted with the reason), a distance, a primary path, a path count, flags, and, for orders, a value. For customers, it has its attributed orders and SLA commitments.
- **Exposure Figure**: a sum of order values per currency (total, current or potential), with the orders it covers, the orders left out and why, the inferred or manual share, and the low-to-high range when sources disagree on values.
- **Drill-down List**: the paginated, ordered entities behind one number, with that number's total and the computed time.
- **Purchase Order**: a new entity type for a replenishment order issued to a supplier. It depends on its supplier and the products it contains, and customer orders can depend on it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Starting from the entity list, a signed-in user can open Fabrikam Components and read how many customer orders and customers are currently affected and the total exposure, in under 30 seconds and without leaving the Entity 360 page.
- **SC-002**: From any number in an impact result, a user reaches the list of entities behind it, with a path for each, in one selection. 100% of lists match their numbers in length, and 100% of exposure lists add up exactly to their figures. Both are verified by automated tests over both seeded datasets.
- **SC-003**: In a data store with 50,000 entities and at least 150,000 relationships, an impact analysis for one entity whose impact reaches at least 2,000 entities within the default depth returns its summary in under 2 seconds at the 95th percentile over 20 runs. The first page of any drill-down list for that analysis returns in under 2 seconds at the 95th percentile.
- **SC-004**: In the same data store, the Entity 360 page shows its Impact summary and category table in under 3 seconds.
- **SC-005**: 100% of the acceptance scenarios in Stories 1 to 3 pass in automated tests against the seeded datasets.
- **SC-006**: 100 consecutive analyses of each acceptance entity against unchanged data produce identical results, excluding computed time.
- **SC-007**: In automated tests over at least 1,000 generated graphs with cycles, diamonds and parallel paths:
  - every analysis terminates;
  - no path exceeds the requested depth or repeats an entity;
  - no order's value is counted more than once in any exposure figure.
- **SC-008**: 100% of counted entities and exposure shares reached only through inferred or manual links are labeled as such in both the structured result and the summary text. Verified by automated tests over both seeded datasets.

## Assumptions

- **Scope boundaries**: Out of scope, for later features:
  - what-if simulation with durations or changed parameters (§13, §43);
  - time-based predictions, such as "will breach its SLA on Friday";
  - risk scoring (§14, §15);
  - recommendations, prioritization advice, alternative suppliers and mitigations (§33);
  - inventory and stock-level modeling (§40's "inventory dependencies"). Stock is represented only by customer orders depending on purchase orders;
  - exceptions, investigations and saved analyses;
  - a graph view of impact.
- **"Potential" means reachable, not predicted**: §12 lists "predicted impact". This spec reports **potential** impact: entities that depend on the analyzed entity and would be affected if its problem continued or arose. It makes no claim about when or how likely that is, which would need simulation and risk features.
- **"Current" needs an unbroken chain**: an entity counts as currently affected only when every entity between the analyzed one and it is already impaired. An impaired entity behind an unimpaired one may be impaired for another reason, so it is not blamed on the analyzed entity. It is shown as potential and flagged instead. This is conservative by design (Constitution Principle II).
- **AT_RISK and SUSPENDED count as impaired for impact**: feature 003 treats AT_RISK as satisfied, because it does not stop progress. For impact, an at-risk SLA commitment is already affected, so it counts as current. SUSPENDED is how the seed represents "unavailable".
- **Completed and cancelled entities are not affected**: a delivered order or received purchase order cannot be harmed further. It is listed, not counted, and nothing is reached through it.
- **Customers by attribution**: under feature 003's direction rules, customers are upstream of their orders, so a downstream walk never reaches them. Customers are counted when they own an affected order or SLA commitment. These two links are recorded relationships, shown on every customer row.
- **Exposure is customer-order value**: §12 calls it "potential revenue exposure". Payment, invoice and purchase-order amounts describe the same money or costs, and adding them would double count it.
- **The analyzed entity is excluded**: its own value is shown separately, so a blocked order's analysis answers "what else does it affect?"
- **Purchase order type**: the user's categories and §40's chain need purchase orders, which the feature 002 vocabulary lacks. This feature adds the type and its relationship rules. It is a vocabulary extension: existing data and the dependency direction rules are unchanged.
- **Separate seed dataset**: the §39 dataset is a frozen acceptance fixture for features 002 to 005. "Supplier X unavailable" therefore gets its own disconnected dataset, named after §40, with a supplier given a realistic name (Fabrikam Components). Its total exposure of 84,000.00 USD echoes §12 and §42. The §39 suppliers are covered too: Story 3, scenarios 7 and 8 show the "if it became unavailable" form.
- **Paths per entity are capped**: the number of distinct paths can grow combinatorially, so each entity shows its primary path, its shortest path and up to 20 alternatives (FR-022). Counting and exposure never depend on that cap.
- **Existing foundation**: sign-in, roles, the error format, shared schemas, the entity model, both tracing traversals, path ranking, hop evidence, the reference seed and the Entity 360 page come from features 001 to 005 and are reused. This feature adds the Impact section that feature 003, FR-032 deferred.
- **Performance dataset**: the 50,000-entity graph from features 002 and 003 is extended with suppliers, products and purchase orders, so that at least one supplier's impact reaches 2,000 or more entities within the default depth.
