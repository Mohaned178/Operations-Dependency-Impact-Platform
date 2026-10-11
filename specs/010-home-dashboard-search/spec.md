# Feature Specification: Home Overview and Search

**Feature Branch**: `010-home-dashboard-search`
**Created**: 2026-10-07
**Status**: Draft
**Input**: User description: "Home overview and search (Product Overview §20, §21, §47). Home answers "What requires attention right now?": critical open exceptions, high risks, SLA risks (breaching soon / breached), revenue at risk with breakdown by cause category (supplier, payment, warehouse, approval, other), unresolved blockers, recurring root causes in the last 30 days (same root cause causing ≥3 exceptions), and data freshness per source system. Every number drills down to the underlying list and then to Entity 360 or the graph. Home is role-aware (Ops Manager sees totals first; Analyst sees "assigned to me" first). Global search in the header (keyboard shortcut): find entities by name/identifier/external source id, and exceptions and investigations by ID/title, with type filters and highlighted matches, under 1 second on 50k entities using PostgreSQL full-text/trigram indexes. Saved structured filters (e.g. "orders blocked by payment issues", "orders at risk of SLA breach") are in scope; natural-language search is NOT."

## Overview

Features 002 to 009 each answer one question well, but only once the user knows where to look: an Entity 360 page, the Exceptions area, an investigation, the Risks & Alerts area. Nothing answers the first question of the day (§47), **"What requires attention right now?"**, and there is no fast way to jump to "Order #18492", "PAY-88213" or "EX-10001" from anywhere.

This feature adds three connected capabilities.

**1. Home overview (§21, §47).** The Home page shows, on one screen:

> **Critical open exceptions**: 1 · **Risks**: open HIGH and MEDIUM counts · **SLA commitments**: 0 at risk, 8 breached · **Resolution SLA**: at risk and breached counts
>
> **Revenue at risk**: **89,065.00 USD** across 25 customer orders (snapshot #1, as of 2026-10-05 16:00 UTC)
> → Supplier issues 51,250.00 USD (6 orders) → Payment issues 0.00 USD → Warehouse and shipping issues 0.00 USD → Approval issues 31,400.00 USD (17 orders) → Other 6,415.00 USD (2 orders)
>
> **Unresolved blockers**: 2, led by Budget code for Order #18492 (holding 17 at-risk orders, 31,400.00 USD; EX-10001) and Fabrikam Components (6 orders, 51,250.00 USD)
>
> **Frequent root causes** (same root cause behind 3 or more exceptions in the last 30 days) · **Data freshness**: 4 of 11 source systems stale

(Values from the seeded reference scenarios at 2026-10-05T16:00:00Z. Risk and resolution-SLA counts are pinned by equality with their 009 and 007 lists, see contracts fixture H5.)

Every number opens the exact list behind it: the exceptions, risks, SLA commitments, orders, blockers or root causes that make it up. Every list row leads to the entity's Entity 360 page, and order and blocker rows also lead to the Graph Explorer (004). The figures are **aggregated from the features that own them**, never re-derived: exceptions and their resolution SLA from 007, risks and SLA commitments from 009, root causes from 005 (and their recorded labels from 007/008 snapshots), order values and the no-double-counting rule from 006.

**Revenue at risk** is the value of the customer orders that currently need attention, each counted once. Each order is attributed to **exactly one cause category**, the category of its primary root cause (005), so the categories always add up exactly to the total. This is 006's no-double-counting rule applied to categories.

Home is **role-aware**: Operations Managers and Administrators see the totals first; Operations Analysts see **Assigned to me** (their exceptions and investigations) first. The content is the same for every role.

**2. Global search (§20).** A search box in the header, opened from anywhere with **/** or **Ctrl+K** (⌘K on macOS), finds entities by name, identifier or any source system's id, and exceptions and investigations by number or title. Results are grouped, can be narrowed by type, show the matching text highlighted, and appear in under one second on a graph of 50,000 entities. Exact identifier matches come first; small typos still find the record.

**3. Saved structured filters (§20).** The Entities list gains structured criteria (several types and states, the state class, the root-cause category, open risk level and type, SLA commitment status, unresolved exceptions). Users save a combination under a name and reopen it later. Built-in filters cover the §20 examples: "Orders blocked by payment issues", "Orders at risk of SLA breach", "Orders blocked by approvals" and others.

Terminology is reconciled with feature 008: there, a root cause is **recurring** when its label was recorded on at least two **distinct root-cause entities** within 30 days. This feature's Home list counts something different, how many **exceptions** a root cause was behind, so it is named **Frequent root causes** (3 or more exceptions within 30 days). Both use the same labels, the same recorded snapshots and the same 30-day window; each frequent row also states whether the root cause is recurring in 008's sense.

It does **not** deliver natural-language search or query parsing, search inside notes, comments, descriptions or source payloads, customizable Home layouts or widgets, charts and trends over time, currency conversion, notifications, per-source freshness thresholds, or integration health beyond freshness (sync errors, rejected imports). Those are later features.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what requires attention right now (Priority: P1)

An Operations Manager signs in at the start of the day and lands on Home. Above everything else it shows the totals: one critical open exception, the number of HIGH and MEDIUM risks, how many SLA commitments are at risk (breaching soon) or already breached, how many exceptions are at risk of missing their resolution SLA, the revenue at risk with its breakdown by cause category, the unresolved blockers, the frequent root causes of the last 30 days, and which source systems are stale. Each section names the time its figures are "as of". Below the totals, an **Assigned to me** section lists the manager's own and their teams' exceptions and their investigations.

**Why this priority**: This is §47's purpose: one screen that tells an operations team where to look first, using the conclusions every other feature already produces.

**Independent Test**: Seed both reference scenarios, run a risk evaluation as of 2026-10-05T16:00:00Z, and open Home as the Operations Manager with that evaluation time. Compare every figure with contracts fixtures H1 to H5, and check that each figure equals the total of the list it opens.

**Acceptance Scenarios**:

1. **Given** the seeded scenarios and a risk evaluation as of 2026-10-05T16:00:00Z, **When** an Operations Manager opens Home, **Then** the totals section comes first and shows: critical open exceptions, risks by level (HIGH, MEDIUM), SLA commitments at risk and breached, exceptions whose resolution SLA is at risk or breached, revenue at risk with its five categories, unresolved blockers, frequent root causes and data freshness, each with its "as of" time.
2. **Given** the same data, **When** each figure is compared with the list it opens, **Then** the figure equals that list's total, and for money, the sum of that list's values.
3. **Given** a section whose underlying feature fails to answer, **When** Home is opened, **Then** that section says it is unavailable and why, and every other section still shows.
4. **Given** no risk evaluation has completed yet, **When** Home is opened, **Then** the risk figures say "No risk evaluation has run yet", and revenue at risk and unresolved blockers say no snapshot is available yet.
5. **Given** any figure on Home, **When** Home is reloaded against unchanged data with the same evaluation time, **Then** every figure, list and sentence is identical.

---

### User Story 2 - Drill down from any number to the records behind it (Priority: P1)

The manager selects **Approval issues 31,400.00 USD**. A list opens with the 17 orders behind it, highest value first, with a total row of exactly 31,400.00 USD. Each row shows the order, its customer, its value, why it is at risk (impaired, open risk, SLA commitment), its root cause with label and confidence ("Budget Code Missing", HIGH), and links to the order's Entity 360 page, to the root-cause entity, and to the Graph Explorer centred on the order. Selecting **Unresolved blockers** lists Budget code for Order #18492 and Fabrikam Components, each with the at-risk orders it holds, their value and the unresolved exceptions that already track it.

**Why this priority**: §21 says the important characteristic is drill-down; a number that cannot be opened cannot be trusted (Constitution III).

**Independent Test**: For every figure of fixtures H1 to H3, open its list and check its length, its sum, its order, its links and that every root cause shown equals feature 005's analysis of that order at the snapshot time.

**Acceptance Scenarios**:

1. **Given** Home, **When** critical open exceptions, a risk count, an SLA count or an Assigned-to-me count is selected, **Then** the corresponding existing list opens (Exceptions area, Risks & Alerts, SLA commitments tab, Investigations area) with the filters that produce exactly that number, kept in the page address.
2. **Given** revenue at risk, **When** the total, a category or a currency is selected, **Then** the at-risk order list opens filtered to it; its length equals the order count, its values add up exactly to the figure, and orders without a usable value are listed separately and never summed.
3. **Given** an at-risk order row, **When** it is opened, **Then** it shows every reason the order is at risk, its value (with every source's value when sources disagree), its root-cause status, label, confidence and root-cause entity, the categories of its other root-cause candidates (if any) marked "not counted", and links to Entity 360, the root-cause entity and the Graph Explorer.
4. **Given** the unresolved blockers list, **When** a blocker is opened, **Then** it lists the at-risk orders it holds, their value per currency, and the unresolved exceptions linked to it, with links to its Entity 360 page, its impact section (006) and the Graph Explorer.
5. **Given** the frequent root causes list, **When** a root cause is selected, **Then** the Exceptions area opens filtered to the exceptions that recorded that root cause in the window, and their number equals the figure.

---

### User Story 3 - Find any record in a second (Priority: P1)

Anywhere in the application, an analyst presses **/** and types "18492". Within a second, grouped results appear: under **Entities**, Order #18492 (its OMS identifier "18492" matches exactly) and Budget code for Order #18492; under **Investigations**, INV-10001 "Why is Order #18492 delayed?". The matching characters are highlighted in each result. Arrow keys move through the results, Enter opens the selected one, Escape closes the box. Typing "PAY-88213" puts Payment PAY-88213 first. A typo, "Fabrikam Componets", still finds Fabrikam Components. The analyst narrows results to **Exceptions** only, or to entities of type **Budget requirement**, and selects **See all results** to open a full results page.

**Why this priority**: §20 requires the whole operational graph to be discoverable, and every other workflow starts by finding a record.

**Independent Test**: On the seeded scenarios, run the queries of contracts fixture H7 and compare groups, order, tiers and highlight ranges. On the 50,000-entity performance dataset, time 20 runs of each query.

**Acceptance Scenarios**:

1. **Given** the seeded data, **When** "18492" is searched, **Then** results are grouped as Entities (Order #18492, then Budget code for Order #18492), Exceptions (none) and Investigations (INV-10001), with the matching ranges of every matching field highlighted.
2. **Given** a query that exactly equals an identifier, a source system's id, an exception number ("EX-10001" or "10001") or an investigation number ("INV-10001"), **When** it is searched, **Then** that record is ranked first in its group.
3. **Given** a query with a small typo that matches nothing exactly, by prefix or as a substring in a group, **When** it is searched, **Then** that group returns the records whose name or title is similar, marked as similar matches, without highlights.
4. **Given** type filters (groups and entity types), **When** they are applied, **Then** only those groups and entity types are searched and shown.
5. **Given** any page, **When** **/** (outside a text field) or **Ctrl+K**/**⌘K** is pressed, **Then** the search box opens with focus; the whole search can be completed with the keyboard.
6. **Given** a query shorter than 2 or longer than 100 characters, **When** it is submitted, **Then** it is refused with a validation message and nothing is searched.
7. **Given** unchanged data, **When** the same search is repeated, **Then** the results, their order and their highlights are identical.

---

### User Story 4 - Role-aware Home with "Assigned to me" (Priority: P2)

An Operations Analyst opens Home. The first section is **Assigned to me**: their unresolved exceptions, the unresolved exceptions of their teams, and their open investigations (INV-10001 "Why is Order #18492 delayed?"), most urgent first, each with its SLA indicator. The totals follow. An Operations Manager or Administrator sees the totals first and Assigned to me after them.

**Why this priority**: §38 gives managers and analysts different needs. The order of sections is the only difference, so no figure differs between roles.

**Independent Test**: Open Home as each seeded user and check the section order and the Assigned-to-me counts against fixture H5.

**Acceptance Scenarios**:

1. **Given** an Operations Analyst, **When** Home opens, **Then** Assigned to me is first; **Given** an Operations Manager or Administrator, **Then** the totals are first.
2. **Given** a user, **When** Assigned to me is shown, **Then** it gives three counts, each opening its list: exceptions owned by the user (unresolved), exceptions owned by one of the user's teams (unresolved), investigations owned by the user and not closed; and up to 5 items of each, most urgent first.
3. **Given** a user with nothing assigned, **When** Home opens, **Then** Assigned to me is a single line saying so.
4. **Given** two users with different roles, **When** they open Home at the same evaluation time, **Then** every figure is identical; only the order of sections differs.

---

### User Story 5 - Save and reuse structured filters (Priority: P2)

A Finance Operations user opens **Entities**, chooses the built-in filter **Orders blocked by payment issues**, then builds their own: type Order, state class impaired, root-cause category Approval, with an unresolved exception. They save it as "Approval-blocked orders with a case". It appears under **My filters** on the Entities page and in the empty search box, and opens the same list later. They rename it, change it, and finally delete it.

**Why this priority**: §20's "more advanced queries" are recurring questions; a saved filter answers them with one selection, without natural-language parsing.

**Independent Test**: As a seeded user, apply each built-in filter on the seeded scenarios after the reference snapshot and compare the results with fixture H6. Create, rename, update and delete a filter, and check validation, ownership and the audit trail.

**Acceptance Scenarios**:

1. **Given** the Entities page, **When** criteria are combined (types, states, state class, source system, text, root-cause category, open risk level, open risk type, SLA commitment status, has an unresolved exception), **Then** the list shows exactly the entities that meet all of them, and the criteria are kept in the page address.
2. **Given** the built-in filters, **When** one is applied, **Then** its criteria are shown and the list follows them; built-in filters cannot be changed or deleted.
3. **Given** a signed-in user, **When** they save criteria with a name, **Then** the filter is stored as theirs, listed under My filters, and the creation is audited; renaming, changing and deleting are audited with before and after values.
4. **Given** a name already used by the same user (ignoring case), or a 51st filter, **When** it is saved, **Then** it is refused with a reason and nothing is stored.
5. **Given** another user's saved filter, **When** a user tries to read, change or delete it, **Then** it is treated as not found. Saved filters are private.
6. **Given** a criterion based on the revenue-at-risk snapshot (root-cause category), **When** the list is shown, **Then** it states the snapshot it used and its "as of" time.

---

### User Story 6 - Know when conclusions rest on old data (Priority: P3)

The manager sees on Home that 4 of 11 source systems are **stale**: Payments, FinanceApprovals, WMS and ManualEntry have sent nothing newer than 2026-09-29 15:00, more than 24 hours before the evaluation time. Each source system shows the newest observation time of its records, the newest receive time, how long ago that was, and whether it is fresh or stale. The revenue-at-risk section names the stale systems that contributed to it.

**Why this priority**: §52 requires users to know when a conclusion is based on old data; it is a small read-only view of provenance OpsGraph already stores.

**Independent Test**: On the seeded scenarios, request the freshness view at 2026-10-05T16:00:00Z and compare it with fixture H4.

**Acceptance Scenarios**:

1. **Given** the seeded scenarios, **When** data freshness is shown as of 2026-10-05T16:00:00Z, **Then** it lists all 11 source systems, the 4 stale ones first, each with its newest observation and receive times, its age and its status.
2. **Given** a source system whose newest record is observed after the evaluation time, **When** it is shown, **Then** its age is zero and it is marked "observed after the evaluation time".
3. **Given** the revenue-at-risk section, **When** any at-risk order's state was last observed by a stale source system, **Then** the section names those stale systems.

---

### Edge Cases

- **No completed risk evaluation**: risk figures, revenue at risk and blockers say so; the other sections still show.
- **Snapshot older than the evaluation time**: Home uses the latest completed snapshot whose "as of" time is not after the evaluation time, and states that time. A snapshot computed while the graph changed is marked "data changed while this snapshot was computed".
- **Several currencies**: revenue at risk is reported per currency and never converted or added across currencies (006).
- **Order without a usable value**: counted in the order count of its category, listed as "value unknown", left out of every sum, and stated next to the figure.
- **Order values that disagree between sources**: the current value is used; the figure also states the lowest and highest totals the disagreeing values allow (006).
- **Order with several root-cause candidates in different categories**: counted once, in the category of its first-ranked candidate; the other categories are shown on the row as "also involves … (not counted)".
- **Order not blocked, unexplained, or not analyzed**: counted in **Other**, with the sub-reason ("not blocked", "no root cause can be named", "analysis limit reached", "analysis failed").
- **Possible root causes**: a root cause with LOW confidence (005's "insufficient evidence") still decides the category, and each category states how much of its value rests on such root causes. It is never presented as a confirmed cause.
- **Too many at-risk orders**: at most 5,000 orders are analyzed per snapshot, in a fixed order (risk level, then value, then name); the rest are counted in Other as "analysis limit reached", and the snapshot says so.
- **Frequent root causes with one exception recording a label several times**: the exception counts once per label. A snapshot taken exactly 30 days before the evaluation time is outside the window; one taken exactly at it is inside (008's window).
- **Search query with special characters** (`%`, `_`, `\`, quotes): matched literally.
- **Search with no result**: a group with no exact, prefix or substring match falls back to similar names or titles; if there are none, it says "No matches".
- **More than the shown results**: each group states its total (up to 1,000, then "1,000+") and links to the full list.
- **Saved filter that references something that no longer applies** (a risk type disabled, no snapshot yet): it still opens; the list states why a criterion matches nothing.
- **Deactivated user**: their saved filters remain stored and private.
- **Clock skew**: a source record observed after the evaluation time has age zero and is flagged.
- **Unauthenticated caller**: refused on every new capability. Malformed identifiers and invalid filters are refused with a validation error naming the field. A nonexistent snapshot, saved filter or category is refused as not found.

## Requirements *(mandatory)*

### Functional Requirements

**Home: composition and roles**

- **FR-001**: Home MUST show these sections: **Totals** (critical open exceptions, risks, SLA, revenue at risk, unresolved blockers, frequent root causes, data freshness) and **Assigned to me**. Operations Managers and Administrators MUST see Totals first; Operations Analysts MUST see Assigned to me first. Roles MUST NOT change any figure.
- **FR-002**: Every Home figure MUST be computed **by the feature that owns the underlying data**, through that feature's own rules, never by a second implementation:
  - exceptions, their views and resolution SLA statuses: feature 007;
  - investigations and their views: feature 008;
  - risks and SLA commitments: feature 009;
  - root causes: feature 005; recorded root-cause labels: the root-cause snapshots of 007 and 008;
  - order values and exposure arithmetic: feature 006.
- **FR-003**: Home MUST accept an **evaluation time** (default: now) used for every time-dependent figure (SLA statuses, freshness, the 30-day window), and MUST state it. Against unchanged data, the same evaluation time MUST give identical figures, lists and sentences.
- **FR-004**: Each section MUST load and fail independently: a section that cannot be computed MUST say so with a reason, and MUST NOT hide the others.

**Home: exceptions, risks and SLA**

- **FR-005**: **Critical open exceptions** MUST equal the total of 007's Critical view (critical severity, unresolved), and show the 5 most urgent by resolution SLA due time.
- **FR-006**: **Risks** MUST show the number of open HIGH and open MEDIUM risks (009), the time of the latest completed risk evaluation, and the 5 highest-scoring open HIGH risks.
- **FR-007**: **SLA** MUST show, under clearly different labels:
  - **SLA commitments** (009): the number of running commitments **At risk (breaching soon)** and **Breached** at the evaluation time, and the 5 most urgent of them;
  - **Resolution SLA** (007): the number of unresolved exceptions whose resolution SLA is **At risk** and **Breached** at the evaluation time.

  The two MUST use 009/007's single status vocabulary and at-risk rule, and MUST NOT be added together.

**Home: revenue at risk**

- **FR-008**: Revenue at risk MUST be computed in a stored **snapshot**, after each completed risk evaluation (009) and as of that evaluation's "as of" time, so that the figure and every list behind it come from one consistent computation. An Administrator MAY request a snapshot as of the latest completed risk evaluation.
- **FR-009**: A customer order is **at risk** in a snapshot when it is not terminal (COMPLETED, CANCELLED) and at least one of these holds:
  - **Impaired**: its current state is impaired (006's state class);
  - **Risk**: it has an open risk of level HIGH or MEDIUM (009);
  - **SLA**: it has a running SLA commitment that is At risk or Breached at the snapshot time (009).

  Each order MUST record every reason that holds. Purchase orders are never customer orders (006).
- **FR-010**: Each at-risk order MUST be attributed to **exactly one cause category**, from the **first-ranked candidate** of feature 005's root-cause analysis of that order at the snapshot time and 005's default depth, by the type of the candidate's root-cause entity:

  | Category | Root-cause entity types |
  |---|---|
  | Supplier issues | Supplier, Product, Purchase order |
  | Payment issues | Payment, Invoice |
  | Warehouse and shipping issues | Warehouse, Shipment |
  | Approval issues | Approval, Budget requirement |
  | Other | Order, Customer, Contract, SLA; and every order whose analysis is "not blocked", "unexplained", not run (limit) or failed |

  The mapping MUST be published with the figures. Every entity type MUST map to exactly one category.
- **FR-011**: Revenue at risk MUST follow 006's value rules: per currency with no conversion; the order's current value; each order counted once; orders without a usable value counted but left out of sums; disagreeing source values shown, with the lowest and highest totals they allow. Per currency, the figure MUST give the total and, for each of the five categories, the amount and order count, and the categories MUST add up exactly to the total.
- **FR-012**: Each category figure MUST also state the part of its value whose root cause has LOW confidence ("possible root cause"), and the part from orders with a value disagreement.
- **FR-013**: Each at-risk order in a snapshot MUST record: the order, its customer, its reasons (with the state and its source observation, the risk number and level, the SLA commitment and status), its value and currency or "value unknown", its source values when they disagree, its root-cause status, the root-cause entity, label and confidence of the first-ranked candidate, the number of candidates, the categories of the other candidates (not counted), and its category.
- **FR-014**: At most **5,000** at-risk orders MUST be analyzed per snapshot, in a fixed order (open risk level HIGH first, then MEDIUM, then none; then value descending within currency code order; then display name; then identifier). Orders beyond the limit MUST be counted in Other with the sub-reason "analysis limit reached", and the snapshot MUST say how many.
- **FR-015**: Each snapshot MUST record its number, trigger (after evaluation, manual), the risk evaluation it used, its "as of" time, start and end times, status (running, completed, failed), the graph version read at its start and end and whether they match, the counts of at-risk and analyzed orders, and any error. At most one snapshot MUST run at a time; a trigger arriving during a run MUST cause exactly one further run.
- **FR-016**: Snapshots of the last 24 hours, and always the latest completed one, MUST be kept; older ones MAY be removed. Removal MUST be audited. A list that refers to a removed snapshot MUST say it is no longer available and link to the latest one.

**Home: unresolved blockers and frequent root causes**

- **FR-017**: **Unresolved blockers** MUST be the distinct root-cause entities of the first-ranked candidates of the at-risk orders in the latest snapshot. Each blocker MUST show its name, type, current state, 005 label and confidence, the number of at-risk orders it holds, their value per currency, and the unresolved exceptions linked to it in any role (up to 3, with the total). The list MUST be ordered by number of orders held (descending), then display name, then identifier.
- **FR-018**: **Frequent root causes** MUST list every root-cause label recorded, in the 30-day window ending at the evaluation time (excluding its start, including its end, as in 008), in the root-cause snapshots of **at least 3 distinct exceptions**. Each row MUST show the label, the number of distinct exceptions, the number of distinct root-cause entities, how many of those exceptions are unresolved, and whether the label is **recurring** under 008's rule (recorded on at least two distinct root-cause entities in the window, counting investigation pins and exception snapshots). Rows MUST be ordered by exception count (descending), then label.
- **FR-019**: The terms MUST stay distinct: "recurring" keeps feature 008's meaning everywhere; this feature's measure is named "frequent". The threshold (3 exceptions) and window (30 days) are fixed, published rules.

**Home: data freshness and Assigned to me**

- **FR-020**: **Data freshness** MUST list every source system that has source records, with: the newest observation time of its records, the newest receive time, the age of the newest observation at the evaluation time (zero, and flagged, when it is later), and a status: **Stale** when the newest observation is more than **24 hours** before the evaluation time, otherwise **Fresh**. Stale systems MUST be listed first, then by newest observation (oldest first), then name.
- **FR-021**: The revenue-at-risk section MUST name the stale source systems whose state observations explain the "impaired" reason of any of its orders.
- **FR-022**: **Assigned to me** MUST show: unresolved exceptions owned by the user (007 view "Mine"), unresolved exceptions owned by one of the user's teams (007 view "My teams"), and investigations owned by the user and not closed (008 view "Mine"), each with its count and up to 5 items, most urgent first, each count opening its list.

**Drill-down**

- **FR-023**: Every Home figure MUST open the list that produces it, and its length MUST equal the figure (for money, its values MUST add up exactly to the figure). Figures owned by 007, 008 and 009 MUST open those features' existing lists with the matching filters, kept in the page address.
- **FR-024**: The **at-risk orders** list MUST be filterable by snapshot, currency, category and "value unknown", ordered by value (descending), then display name, then identifier, paginated, with a total row.
- **FR-025**: 007's exception list MUST gain a filter "recorded root cause L in the 30-day window ending at T", used by the frequent root causes drill-down; its results MUST equal the row's exception count.
- **FR-026**: Every list row MUST link to the entity's Entity 360 page; order and blocker rows MUST also link to the Graph Explorer centred on that entity, and blockers to their impact section.

**Global search**

- **FR-027**: A search box MUST be available in the header of every signed-in page, opened by **/** (when focus is not in a text field) and by **Ctrl+K** or **⌘K**, fully usable by keyboard (arrows, Enter, Escape).
- **FR-028**: Search MUST find:
  - **entities** by display name and by any identifier of any source system;
  - **exceptions** by number (with or without "EX-") and title;
  - **investigations** by number (with or without "INV-") and title.

  Queries MUST be 2 to 100 characters after trimming and are matched literally (no operators, no natural language).
- **FR-029**: Results MUST be ranked in tiers: **exact** (the whole query equals a name, identifier, title or number, ignoring case), **prefix**, **contains**. Only when a group has no result in these tiers, it MUST return **similar** results instead (names and titles only, tolerant of small typos, using a fixed similarity threshold). Within a tier: display name or title, then identifier. Each result MUST state its tier.
- **FR-030**: Each result MUST return the fields that matched with the character ranges of every occurrence of the query (ignoring case), for highlighting. Similar matches carry no ranges.
- **FR-031**: Search MUST be filterable by group (entities, exceptions, investigations) and entity type (several). Each group MUST show up to 10 results in the box and up to 50 on the results page, with its total up to 1,000 ("1,000+" beyond).
- **FR-032**: Each entity result MUST show type, name, current state and the matching identifier with its source system; each exception result its number, title, severity, status and subject; each investigation result its number, title, severity, status and focus entity.

**Structured and saved filters**

- **FR-033**: The Entities list MUST accept, combinable, in addition to its existing filters: several entity types; several states; state classes (impaired, unimpaired, terminal, indeterminate, as in 006); root-cause categories (orders only, from the latest snapshot, stated with its time); open risk levels; open risk types; SLA commitment statuses At risk and Breached at an evaluation time (default now); and "has an unresolved exception". Single type and state values MUST keep working as before.
- **FR-034**: System MUST provide read-only **built-in filters**: Orders blocked by payment issues; Orders blocked by supplier issues; Orders blocked by approvals; Orders blocked by warehouse or shipping issues; Orders at risk of SLA breach; Entities with a HIGH risk; Entities with an unresolved exception (criteria in contracts).
- **FR-035**: Every signed-in user MUST be able to save, rename, change and delete their own **saved filters**: a name (1 to 80 characters, unique per user ignoring case) and criteria valid under FR-033; at most 50 per user. Saved filters MUST be private to their owner.
- **FR-036**: Saved and built-in filters MUST be offered on the Entities page and in the search box when it is empty.

**Permissions, audit and access**

- **FR-037**: Permissions:

  | Action | Allowed for |
  |---|---|
  | View Home, every drill-down list, data freshness, snapshots; search; use built-in filters | every signed-in user |
  | Create, rename, change, delete saved filters | the owner only (others get "not found") |
  | Request a snapshot | Administrators |

  A refused action MUST change nothing and MUST be audited as a refusal.
- **FR-038**: Every mutation MUST write an audit record atomically with the change, with actor, action, target, time, and before and after values: saved filter created, updated, deleted; snapshot completed or failed (System, or the requesting Administrator); snapshots removed (System, with how many).
- **FR-039**: Unauthenticated callers MUST be refused on every new capability. Every new request and response payload MUST be defined once as a shared, validated schema used by the backend and the web app. Every new endpoint MUST have end-to-end tests for its success path, authentication failure, validation failure and, where it applies, permission refusal, not found and conflict.

**Seed and tests**

- **FR-040**: The seed MUST NOT add data for this feature (no snapshot, no saved filter); the §39 and §40 datasets and the 007, 008 and 009 seed rows MUST remain unchanged.
- **FR-041**: Automated tests MUST cover at least:
  - fixtures H1 to H7 on the seeded scenarios and built sets;
  - every Home figure equal to its list's total and sum (FR-023);
  - each at-risk order's root cause equal to feature 005's analysis at the snapshot time; the category figure of a single root-cause entity equal to 006's current exposure of that entity where all its current orders are at risk (both seeds);
  - categories adding up to the total per currency, multi-path orders counted once, several currencies, value unknown, value disagreement, multiple candidates in different categories, the analysis limit;
  - the frequent root causes window boundaries and the "recurring" indicator equal to 008's rule;
  - freshness boundaries (exactly 24 hours, observation after the evaluation time);
  - search tiers, highlight ranges, literal special characters, type filters, length limits and determinism;
  - every structured criterion and built-in filter; saved filter validation, privacy, limits and audit;
  - single-run snapshots, coalescing, failure, pruning;
  - every row of the permission table.

### Key Entities

- **Overview Snapshot**: one computation of revenue at risk and blockers as of a risk evaluation's time: number, trigger, risk evaluation, as-of time, graph versions, status, counts, totals per currency and category.
- **At-risk Order (snapshot row)**: one order in a snapshot: reasons, value, root cause (status, entity, label, confidence), category, other categories.
- **Cause Category**: one of five fixed categories (Supplier, Payment, Warehouse and shipping, Approval, Other), decided by the root-cause entity's type.
- **Unresolved Blocker**: a distinct root-cause entity of a snapshot, with the orders it holds. Computed from the snapshot, not stored separately.
- **Frequent Root Cause**: a root-cause label recorded for 3 or more exceptions in 30 days. Computed, not stored.
- **Source Freshness**: per source system, the newest observation and receive times, the age and the status. Computed, not stored.
- **Search Result**: one entity, exception or investigation with its tier and highlighted fields. Computed, not stored.
- **Saved Filter**: a named, private set of structured criteria owned by one user.
- **Built-in Filter**: a fixed, read-only named set of criteria available to everyone.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of Home figures equal the total of the list they open, and 100% of money figures equal the exact sum of their lists, on both seeded scenarios and the built sets (automated).
- **SC-002**: Starting from Home, a user reaches the Entity 360 page of any record behind any figure in at most two selections.
- **SC-003**: Revenue-at-risk categories add up exactly to the total in every currency, and no order is counted in more than one category or more than once, in 100% of automated cases.
- **SC-004**: Global search returns its grouped results in under 1 second at the 95th percentile over 20 runs per query, on a dataset of 50,000 entities, 10,000 exceptions and 10,000 investigations.
- **SC-005**: Home loads all sections in under 2 seconds at the 95th percentile on the same dataset with 10,000 open risks; each drill-down list's first page loads in under 1 second.
- **SC-006**: Revenue at risk reflects a completed risk evaluation within 1 minute for up to 1,000 at-risk orders on the 50,000-entity graph, and a snapshot of 1,000 at-risk orders completes in under 2 minutes.
- **SC-007**: After seeding and a risk evaluation as of 2026-10-05T16:00:00Z, Home shows revenue at risk of 89,065.00 USD across 25 orders: Supplier issues 51,250.00 USD, Approval issues 31,400.00 USD, Other 6,415.00 USD, Payment and Warehouse 0.00 USD (fixture H1).
- **SC-008**: A user can open search, find a record by its identifier and open it without using the mouse.
- **SC-009**: 100% of saved-filter changes, snapshot completions, failures and removals appear in the audit trail with before and after values.

## Assumptions

- **Scope boundaries**: out of scope, for later features:
  - natural-language search and query parsing (§57); search in descriptions, comments, notes, evidence or raw source payloads; accent-insensitive matching; ranking by popularity or recency;
  - customizable Home layouts, widgets, per-user Home preferences, charts and trends (§34), "recent incidents", supplier and customer risk dashboards, operational analytics;
  - shared or team saved filters, saved searches over exceptions or investigations, alerts on saved filters, relational criteria beyond FR-033 ("customers with unpaid invoices", "suppliers affecting the most customers"); "entities affected by Warehouse A" is already answered by 006's impact lists;
  - currency conversion; exposure attributed to frequent root causes (§32's "$120,000 associated with the issue") because it would add up overlapping impact snapshots;
  - integration health beyond freshness (sync errors, rejected or incomplete imports), per-source freshness thresholds.
- **Recurring vs frequent** (in place of a clarification on reconciling "≥3 exceptions" with 008): 008 already defines "recurring root cause" as a label recorded on at least two distinct root-cause entities in 30 days, and says the same entity seen by several cases is one problem. Counting exceptions measures something else, so this feature names it "frequent" and shows 008's "recurring" indicator next to it, using the same labels, snapshots and window. 008's rule is unchanged.
- **Revenue at risk definition** (in place of a clarification): §21 gives no definition. An order is at risk when it is impaired, has an open HIGH or MEDIUM risk, or has an SLA commitment at risk or breached. LOW risks are excluded because 009 defines them as below attention. Orders that are only "potentially" affected (006) are not counted unless one of the three reasons holds.
- **Category attribution** (in place of a clarification on no double counting): one order, one category, from 005's first-ranked candidate, so categories add up to the total exactly as 006 counts an order once however many paths reach it. Shipments are grouped with warehouses ("Warehouse and shipping issues") because both are fulfilment; contracts, customers, SLAs and orders as root causes fall in Other. Purchase orders count as supplier issues.
- **Snapshots** (in place of a clarification on freshness of revenue at risk): running feature 005 for every at-risk order on each Home load is too slow, and a live computation could change between a figure and its list. A snapshot after each risk evaluation (every 5 minutes) keeps figure and lists identical and matches the risk figures' time. Snapshots are derived data, so old ones are removed after 24 hours, with an audit record.
- **Unresolved blockers** are the root causes (005) behind at-risk orders, not every impaired entity, so the list names what to fix rather than every symptom.
- **Data freshness** is computed from the observation times of stored source records (§52, Constitution I). The 24-hour stale threshold is a fixed default for the MVP; per-system thresholds are a later feature.
- **Role awareness** only orders sections (§38); Administrators are treated like Operations Managers. No figure is hidden from any role, because every signed-in user may already view every exception, investigation and risk (007, 008, 009).
- **Saved filters are private** (in place of a clarification on sharing): sharing would need ownership, permissions and notification rules beyond this feature; a copied page address already shares the same list.
- **Search matching**: substring and typo-tolerant matching on names, identifiers, numbers and titles. The similarity threshold is a fixed published value, so results are deterministic.
- **Reference evaluation time**: fixtures use 2026-10-05T16:00:00Z (009's T3), after both seeded scenarios.
- **Dependencies**: features 005 (root-cause analysis), 006 (state classes, order values, money arithmetic), 007 (exceptions, views, resolution SLA, snapshots), 008 (investigations, recurrence rule, snapshot table) and 009 (risks, evaluations, SLA commitments, scheduler) must be merged before this feature starts. 004 provides the Graph Explorer links.
- **Existing foundation**: sign-in, roles, users, audit, the error format, shared schemas, the entity model and list (002), imports, the reference seeds and the Entity 360 page come from features 001 to 009 and are reused.
