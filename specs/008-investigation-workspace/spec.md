# Feature Specification: Investigation Workspace

**Feature Branch**: `008-investigation-workspace`
**Created**: 2026-10-07
**Status**: Draft
**Input**: User description: "Investigation workspace (Product Overview §9, §23, §39, §48). An Investigation starts from a question or an entity ("Why is Order #18492 delayed?") and becomes a persistent workspace with tabs: Overview (current state, root cause, immediate blocker, key numbers), Graph (focused explorer from 004), Root Cause (005), Impact (006), Timeline (merged events of all related entities, filterable), Related Entities, Evidence, Actions (linked exceptions and their status from 007), Decisions (recorded human decisions with rationale, author, and the evidence visible at that time), and Notes. Investigations have ID, title, owner, severity, status (Open, Resolved, Closed), linked exceptions, created/updated times. When a root cause or impact result is pinned to an investigation, store a snapshot so history stays accurate even if the graph changes later. Investigations list with filters (open, mine, critical, SLA risk, recurring root cause). All changes audited. Reuse existing APIs; add new endpoints only for investigation CRUD, pinning, decisions and notes."

## Overview

Features 003 to 007 each answer one question on one page: what blocks this entity, why, what it affects, and who owns the problem. A real investigation needs all of them together, kept over days, with the reasoning that led to each step (Product Overview §9, §23). Today an analyst who works out why Order #18492 is stuck has nowhere to keep the question, the findings as they stood at the time, the decisions taken and the notes, and nothing that tells a colleague next week what was known when.

This feature adds the **investigation**: a persistent workspace that starts from a question about one operational entity and gathers everything about it. The §39 investigation becomes real:

> **INV-10001 · Why is Order #18492 delayed?** · Severity **Critical** · Status **Open** · Owner **Operations Analyst**
>
> **Current state**: BLOCKED
> **Root cause**: Budget Code Missing (HIGH), pinned 2026-09-29 16:00
> **Immediate blocker**: Payment PAY-88213 (PENDING)
> **Downstream impact**: 17 customer orders, 4 customers, 3 SLA commitments at risk, **31,400.00 USD** exposed
> **Evidence**: Contract CON-3982, Payment PAY-88213, Finance approval APR-2291 and 3 other records; 7 operational events
> **Actions**: EX-10001 (Critical, Open, Finance Operations)

An investigation has:
- what it is about: a number, a title phrased as the question, an optional description, and one **focus entity**;
- how serious it is and who leads it: a severity, an owner, and a status (Open, Resolved, Closed);
- what was found: **pinned results**. When a user pins a root-cause or impact result, OpsGraph stores it unchanged, with its time, so the investigation keeps what was known even after the data changes;
- what it covers: its **scope**, the focus entity and the entities that the pinned results, linked exceptions and users bring in, each with the reason it is included;
- what is being done: **linked exceptions** (feature 007), with their live status;
- what people concluded: **decisions** with rationale, author, time and the evidence visible when they were made, and **notes**;
- its full history: every change, with who, when, before and after.

The workspace has eleven tabs: **Overview**, **Graph**, **Root Cause**, **Impact**, **Timeline**, **Related Entities**, **Evidence**, **Actions**, **Decisions**, **Notes** and **History**. The Graph, Root Cause and Impact tabs show the live analyses of features 004, 005 and 006 for the focus entity, next to what has been pinned. An **Investigations** area lists every investigation with quick views (Open, Mine, Critical, SLA risk, Recurring root cause, All), filters and sorting.

It does **not** deliver risk detection or risk scoring (§14, §15), what-if analysis (§13), workflows or automated actions (§17, §56), recommended actions (§33), natural-language question parsing (§57), file attachments, or notifications about investigations. Those are later features.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open an investigation and see the answer on one page (Priority: P1)

An Operations Analyst gets a call from Acme Corp: "Why is Order #18492 delayed?" They open Order #18492 on the Entity 360 page and select **Start investigation**. A form opens, pre-filled:

- the focus entity **Order #18492**;
- the suggested title **"Why is Order #18492 blocked?"** (FR-005), which the analyst changes to the customer's words, "Why is Order #18492 delayed?";
- owner: the analyst; "Pin the current root cause and impact" checked.

They choose severity **Critical** and submit. The investigation **INV-10002** is created with status **Open**. Its **Overview** tab answers the question on one screen:

- **Current state** of Order #18492, live, with its source and observation time;
- **Root cause**: the pinned root cause's label and confidence, with the time it was pinned;
- **Immediate blocker**: the first step after the symptom in the pinned root-cause chain;
- **Downstream impact**: the pinned impact's headline sentence and key numbers: customer orders, customers, SLA commitments at risk, exposure;
- the key evidence records, the linked exceptions with their status, the latest decision and the latest note, each with a link to its tab.

**Why this priority**: §39 describes this page as the centre of an investigation, and §65's first seven questions are answered on it. Without it, the analyst has to visit four pages and copy what they find.

**Independent Test**: Seed the reference scenario. As the Analyst, open the seeded investigation INV-10001 and compare the Overview with the scenarios below. Then start a new investigation from Order #18492 and check that its Overview, pins and audit trail follow the same rules.

**Acceptance Scenarios**:

1. **Given** the seeded reference investigation INV-10001, **When** its Overview is opened, **Then** it shows:
   - title "Why is Order #18492 delayed?", severity Critical, status Open, owner Operations Analyst, focus Order #18492;
   - current state BLOCKED, reported by OMS, observed 2026-09-29 11:40;
   - root cause **"Budget Code Missing"**, confidence **HIGH**, analyzed as of 2026-09-29 16:00, on Budget code for Order #18492 (MISSING);
   - immediate blocker **Payment PAY-88213** (PENDING);
   - impact of Budget code for Order #18492 (the root cause): **17** customer orders, **4** customers, **3** SLA commitments currently at risk and **31,400.00 USD** exposure, all current;
   - key evidence: OMS 18492, ERP SO-18492, ContractMgmt CON-3982, Payments PAY-88213, FinanceApprovals APR-2291, FinanceApprovals BR-18492, and 7 operational events;
   - linked exception EX-10001 with its live status, severity, owner and SLA status.
2. **Given** Order #18492's Entity 360 page, **When** **Start investigation** is selected and submitted with severity Critical and "Pin the current root cause and impact" checked, **Then**:
   - the investigation has the next number, status Open, the creator as owner and Order #18492 as focus;
   - one root-cause pin of Order #18492 and one impact pin exist, taken at the creation time; the impact pin is computed for the root-cause entity of the root-cause pin (FR-012);
   - one "investigation created" audit record holds the initial values and the two pins' key figures.
3. **Given** the Investigations area, **When** **New investigation** is selected, **Then** the user types the question as the title, picks the focus entity by search, and the same rules apply. A question without a focus entity cannot be submitted, and the form says why.
4. **Given** "Pin the current root cause and impact" unchecked, **When** the investigation is created, **Then** it has no pins. The Overview shows the live root cause and impact, each labeled **"Live — not pinned"**, with a **Pin** action.
5. **Given** a focus entity that is not blocked (for example Warehouse WH-EAST-02), **When** an investigation is created with pinning, **Then** the root-cause pin records the outcome "not blocked" and names no root cause, the impact pin is computed for the focus entity, and the Overview says "No root cause: Warehouse WH-EAST-02 is ACTIVE and not blocked" instead of a root cause.
6. **Given** an entity that is already the focus of an Open or Resolved investigation, **When** a user starts another investigation on it, **Then** the form lists the existing ones (number, title, status, owner) before submission. Creation is still allowed.
7. **Given** invalid input (empty title, unknown severity, nonexistent focus entity, an owner that is a deactivated user), **When** the form is submitted, **Then** it is refused with a validation error naming the field, and nothing is stored or audited.

---

### User Story 2 - Pin results so the investigation keeps what was known (Priority: P1)

The analyst opens the **Root Cause** tab. It shows the live root-cause analysis of Order #18492 (feature 005), exactly as on the Entity 360 page, and, beside it, the **pinned results** with their times. The live analysis now reports confidence MEDIUM, because the evidence is older than 72 hours; the pin still says HIGH, as it did when pinned. The analyst selects **Pin this result** on the live candidate. A new pin is added and becomes current; the earlier pin stays in the list.

On the **Impact** tab, they choose the anchor, **root cause** (Budget code for Order #18492) or **focus** (Order #18492), view the live impact analysis (feature 006), and pin it.

A week later, a data import releases the payment. The live tabs show the new situation; the pins, the Overview figures and every decision that relied on them are unchanged. The Overview states that the live analysis differs from the pinned one, and how.

**Why this priority**: §37 requires "evidence available at the time". A workspace whose findings silently change when the data changes cannot explain why a decision was taken. Pinning is what makes the investigation a record and not just a view.

**Independent Test**: On a built graph, create an investigation, pin both results, then change the graph through an import. Compare the pins, the Overview and the live tabs before and after the change. Unpin one result and check the current pin and the history.

**Acceptance Scenarios**:

1. **Given** the Root Cause tab of an Open or Resolved investigation, **When** a contributor (FR-020) pins the live result, **Then** OpsGraph runs the root-cause analysis of the focus entity again at the pin time, stores the result with the pin time, the user and the chosen root cause, and makes it the current root-cause pin. The candidate the user selected is the chosen one; otherwise the first-ranked, and the pin says which.
2. **Given** a selected candidate that is no longer a candidate when the pin is submitted, **When** the pin is processed, **Then** it is refused with a validation error, and the user is told to reload the analysis.
3. **Given** the Impact tab, **When** a contributor pins the impact with the anchor **root cause**, **Then** the impact of the current root-cause pin's root-cause entity is stored. **When** there is no current root-cause pin or it names no root cause, **Then** the anchor **root cause** is refused and the anchor **focus** is offered. When no anchor is chosen, the root cause is the anchor if one exists, otherwise the focus (FR-012).
4. **Given** pinned results, **When** the data changes after pinning, **Then** every pin keeps its stored content: root cause, confidence and every confidence reason, chain sentences, chain steps, key evidence, impact counts, exposure and summary sentences, each with the state names and states as they were.
5. **Given** an unresolved investigation whose current pins differ from the live analyses, **When** the Overview is opened, **Then** it lists each difference: root-cause label, root-cause entity or confidence; customer orders, customers, SLA commitments at risk, or exposure per currency. It shows "The live analysis matches the pinned results" when nothing differs.
6. **Given** a pin, **When** a contributor **unpins** it with a reason, **Then** it stays listed as unpinned, with who, when and why, and the current pin of its kind becomes the most recent pin that is still pinned, or none.
7. **Given** a Closed investigation, **When** a pin or unpin is requested, **Then** it is refused until the investigation is reopened.
8. **Given** two users acting on the same investigation from pages loaded at the same time, **When** the second submits a pin, unpin, edit, owner change or status change based on the older version, **Then** it is refused as a conflict, and the user is told to reload.

---

### User Story 3 - See everything connected to the problem: scope, timeline and graph (Priority: P2)

The **Related Entities** tab lists the investigation's **scope**: Order #18492 (focus), Payment PAY-88213, Finance approval APR-2291 and Budget code for Order #18492 (on the pinned root-cause chain), and Shipment SHP-77120 (subject of the linked exception EX-10001). Each row gives its type, current state and every reason it is in scope. The analyst adds Customer Acme Corp by search; it appears with the reason "Added by Operations Analyst". The tab also lists the focus entity's direct neighbors, each with an **Add** action.

The **Timeline** tab merges the operational events and state changes of every entity in scope, oldest first. For INV-10001 the events read like §19: 09:12 order created, 09:14 payment initiated, 10:03 approval requested, 10:05 approval blocked, 10:22 finance notified, 11:40 fulfilment held, 14:32 shipment delayed, 15:10 SLA at risk. Filters narrow it by entity, entity type, kind (events or state changes), source system and time range. Every item names the scope entities it concerns and its source.

The **Graph** tab shows the Graph Explorer of feature 004, focused on the focus entity with blocker paths highlighted, paired with its list. Selecting a node offers **Add to investigation**.

**Why this priority**: §19 asks "How did we get here?" and §23 lists Timeline, Graph and Related Entities as workspace areas. They build on Stories 1 and 2, whose focus and pins define the scope.

**Independent Test**: On the seeded INV-10001, compare the scope, the reasons and the timeline with the scenarios below. Add and remove entities and check the scope, timeline and audit trail. Apply each timeline filter.

**Acceptance Scenarios**:

1. **Given** INV-10001, **When** the Related Entities tab is opened, **Then** the scope is exactly Order #18492, Payment PAY-88213, Finance approval APR-2291, Budget code for Order #18492 and Shipment SHP-77120, with these reasons:
   - Order #18492: Focus; on the pinned root-cause chain (symptom);
   - Payment PAY-88213: on the pinned root-cause chain (immediate blocker);
   - Finance approval APR-2291: on the pinned root-cause chain (upstream cause);
   - Budget code for Order #18492: on the pinned root-cause chain (root cause); anchor of the pinned impact; root cause of EX-10001;
   - Shipment SHP-77120: subject of EX-10001.
2. **Given** the scope rules (FR-015), **When** pins, linked exceptions or added entities change, **Then** the scope is recomputed from them. Nothing else adds or removes an entity, and the scope never holds more than 100 entities.
3. **Given** a contributor, **When** they add an entity by search or from the neighbor list or the graph, **Then** it joins the scope with the reason "Added by <user>", and the change is audited. **When** they remove an added entity, **Then** it leaves the scope unless another reason keeps it. Entities in scope for other reasons cannot be removed.
4. **Given** INV-10001's Timeline tab with the kind filter "events", **When** it is opened, **Then** it lists exactly EVT-OMS-1001, EVT-PAY-2001, EVT-FA-3001, EVT-FA-3002, EVT-FA-3003, EVT-WMS-4001, EVT-TMS-5001 and EVT-CLM-6001, in that order, each once, each naming the scope entities it concerns, its source system, its source identifier and its time.
5. **Given** the Timeline without filters, **When** it is opened, **Then** it also lists the state changes of every scope entity, merged by time, each with its entity, state, source and time. An event that concerns several scope entities appears once.
6. **Given** each timeline filter (entity, entity type, kind, source system, from, to) and their combinations, **When** applied, **Then** only the matching items are listed, in the same order, and the filters are kept in the page address.
7. **Given** a long timeline, **When** it is paged, **Then** no item is skipped or repeated.
8. **Given** the Graph tab, **When** it is opened, **Then** it shows the Graph Explorer focused on the focus entity, with blocker paths highlighted and its textual list beside it, and a link opens the full explorer on the same settings.

---

### User Story 4 - Record decisions and notes with the evidence of the moment (Priority: P2)

After talking to Finance, the analyst records a **decision** on the **Decisions** tab: "Escalate to Finance Operations and hold the consolidated shipment", with the rationale "Releasing SHP-77120 without Order #18492 would split the load; Finance confirms the budget code will be issued today." They cite Contract CON-3982's record and Finance approval APR-2291's record as evidence. The decision is stored with its author and time, and with the **evidence visible at that time**: the current root-cause and impact pins and their key figures, the state of the focus entity, the linked exceptions and their status, and the cited records with their sources.

Two days later the plan changes; the Operations Manager records a new decision that **supersedes** the first. Both stay listed, the first marked "superseded by" the second.

Anyone can add a **note**, for example "Customer called again at 15:00; promised update by end of day". Notes and decisions cannot be edited or deleted.

The **History** tab lists every change to the investigation, oldest first, with actor, time, a sentence and every changed field's before and after values.

**Why this priority**: §23 lists Decisions and Notes, and §37 requires the decision and the evidence available at the time to be preserved. It enriches the investigation created in Story 1.

**Independent Test**: Record a decision citing evidence, pin new results, then compare the decision's stored context with what the Overview showed at decision time. Supersede it. Add notes as several users. Compare the History tab with the audit trail.

**Acceptance Scenarios**:

1. **Given** an Open or Resolved investigation, **When** a contributor records a decision with a statement (1 to 500 characters), a rationale (1 to 4,000 characters) and up to 20 cited evidence items, **Then** it is stored with author and time, and its context records:
   - the current root-cause pin and current impact pin (or none), each with its time and key figures;
   - the focus entity's state, source and observation time at that moment;
   - every linked exception's number, status, severity and SLA status at that moment;
   - every cited item with its kind, source system, source identifier, observation time and entity.
2. **Given** cited evidence, **When** a decision is recorded, **Then** each cited item MUST be one of: a source record of an entity in scope, a key evidence record of a current pin, an active evidence note (feature 005) on an entity in scope, or an active evidence item of a linked exception (feature 007). Anything else is refused with a validation error naming the item.
3. **Given** a decision, **When** pins, states or exceptions change later, **Then** the decision's context is unchanged and is shown labeled "Evidence at decision time".
4. **Given** a decision recorded on a page loaded before another user pinned a new result, **When** it is submitted, **Then** it is refused as a conflict, so that a decision never cites a context its author did not see.
5. **Given** a decision, **When** a later decision names it as superseded, **Then** both remain listed, newest first, and the earlier one shows "Superseded by" with a link. A decision can be superseded only once, and only by a decision of the same investigation.
6. **Given** an investigation in any status, Closed included, **When** any signed-in user adds a note of 1 to 4,000 characters, **Then** it is shown with author and time, newest first.
7. **Given** any change to an investigation, its pins, scope, links, decisions or notes, **When** the History tab is opened, **Then** exactly one entry exists for it, in order, with actor, time, sentence and every changed field's before and after values. The entries are the audit records themselves.

---

### User Story 5 - Track actions through linked exceptions, then resolve and close (Priority: P2)

The **Actions** tab lists the exceptions linked to the investigation, each with its number, title, type, severity, status, owner and SLA status, live from feature 007, unresolved first. The analyst selects **Create exception**: the exception form of feature 007 opens with the focus entity as subject and the pinned root cause as root cause. On creation, the new exception is linked to the investigation. They also link the existing EX-10001 by number.

When the budget code arrives, the exceptions are resolved in feature 007. The owner **resolves** the investigation with the summary "Budget code BC-7781 supplied; Order #18492 released and shipped with SHP-77120". After the exceptions are verified and closed, the owner **closes** the investigation. When the problem comes back, a contributor **reopens** it with a reason.

**Why this priority**: §39 ends with "track progress, verify the final outcome, close the investigation". Exceptions are where work is owned (feature 007); the investigation needs to show their progress, not duplicate it.

**Independent Test**: Link and unlink exceptions, create one from the investigation, then move the investigation through every status as each role, against the transition table (FR-018) and the permission table (FR-020).

**Acceptance Scenarios**:

The allowed transitions are exactly:

| Action | From | To | Required input |
|---|---|---|---|
| Resolve | Open | Resolved | a resolution summary |
| Close | Resolved | Closed | no linked exception is unresolved |
| Reopen | Resolved, Closed | Open | a reopen reason |

1. **Given** the Actions tab, **When** it is opened, **Then** each linked exception shows its live number, title, type, severity, status, owner and SLA status, unresolved first, then by SLA due time.
2. **Given** a contributor, **When** they link an existing exception by number, **Then** it is listed and its subject and root-cause entity join the scope. Linking an exception twice is refused. At most 20 exceptions can be linked.
3. **Given** **Create exception** on the Actions tab, **When** the exception is created in feature 007's form, **Then** it is linked to the investigation, and the investigation's History records the link.
4. **Given** an Open investigation, **When** its owner, an Operations Manager or an Administrator resolves it with a summary of 1 to 2,000 characters, **Then** its status is Resolved with the resolver, the time and the summary. Unresolved linked exceptions do not prevent resolving; the form lists them.
5. **Given** a Resolved investigation with an unresolved linked exception, **When** Close is requested, **Then** it is refused, and the message names each unresolved exception.
6. **Given** a Closed investigation, **When** anything other than a note or Reopen is requested, **Then** it is refused with a message that it must be reopened first.
7. **Given** any action not in the table for the current status, **When** requested, **Then** it is refused, and the message names the current status and the actions allowed from it.
8. **Given** a reopened investigation, **When** it is opened, **Then** its resolution and closure are cleared from it and kept in its history, and its reopen count has increased by one.

---

### User Story 6 - Find the investigations that matter (Priority: P2)

An Operations Manager opens the **Investigations** area. It opens on **Open**, most recently updated first. Quick views switch to **Mine**, **Critical**, **SLA risk**, **Recurring root cause** or **All**. Filters narrow by status, severity, owner and involved entity, and a search box finds an investigation by number or title words. Each row shows the number, title, focus entity, severity, status, owner, pinned root cause with its confidence, pinned impact figures, an SLA indicator, the number of unresolved linked exceptions, and the created and updated times. The view, filters and sort are kept in the page address.

On every Entity 360 page, an **Investigations** section lists the investigations whose scope includes the entity, with a **Start investigation** action.

**Why this priority**: §48 makes the list the centre of the Investigations area. It builds on Stories 1 to 5, which create the investigations and their pins.

**Independent Test**: Build a fixed set of investigations covering every status, severity, owner, pin and linked-exception combination, with a pinned evaluation time. Check each quick view, filter and sort, and their combinations, against the expected lists.

**Acceptance Scenarios**:

1. **Given** the quick views, **When** each is selected, **Then** it lists exactly:
   - **Open**: status Open;
   - **Mine**: owned by the signed-in user, and not Closed;
   - **Critical**: severity Critical and not Closed;
   - **SLA risk**: status Open, and either its current impact pin counts at least one SLA commitment currently affected, or at least one linked unresolved exception has SLA status At risk or Breached at the evaluation time;
   - **Recurring root cause**: its current root-cause pin names a root cause whose label was also recorded, in the 30 days before the evaluation time, for at least one **other** root-cause entity, in any investigation's root-cause pin or any exception's root-cause snapshot;
   - **All**: every investigation.
2. **Given** a recurring row, **When** it is shown, **Then** it states the label and how many distinct root-cause entities carried it in the window (for example "Recurring: Budget Code Missing on 3 root causes in the last 30 days").
3. **Given** each sort (recently updated, newest created, severity), **When** applied, **Then** the order follows FR-024 and is identical on every repetition against unchanged data.
4. **Given** a list longer than one page, **When** it is paged, **Then** no investigation is skipped or repeated, and each page states the total.
5. **Given** an entity page, **When** it is opened, **Then** its Investigations section lists the investigations whose scope includes the entity (Open first, then by last update), with the entity's reason in each, and offers **Start investigation**.

---

### Edge Cases

- **No root cause**: the focus entity is not blocked, or no recorded dependency explains its state. The root-cause pin records that outcome; the Overview shows it instead of a root cause and immediate blocker; the impact anchor is the focus.
- **Low-confidence root cause**: the pin keeps the heading "Possible root cause — insufficient evidence" and its reasons. The Overview never presents it as confirmed.
- **Several candidates**: the pin lists every candidate's label and confidence and marks the chosen one and why (selected, or first-ranked).
- **Root cause chain of one hop**: the root cause is also the immediate blocker; the Overview shows one entity for both.
- **Impact is a lower bound**: when the impact analysis hit a limit, the pin and the Overview keep the "at least" wording.
- **Focus entity changes state**: the Overview's current state is live, the pins are not; the difference is listed (Story 2, scenario 5).
- **Focus entity cannot change**: it is set at creation. A different focus means a new investigation.
- **Unpinning the root cause used as impact anchor**: the impact pin is kept unchanged; it still states its anchor and anchor role.
- **Deactivated owner**: ownership is kept and shown as deactivated; a manager can reassign it.
- **Linked exception closed or reopened in feature 007**: the Actions tab and the list show its live status; the investigation itself does not change.
- **Exception linked to several investigations**: allowed; each investigation lists it.
- **Scope cap**: the scope holds at most 100 entities. Added entities are limited to 40 and linked exceptions to 20, so the cap cannot be exceeded.
- **Empty timeline**: when no scope entity has events or state changes in the filtered range, the tab says so.
- **Cited evidence later retracted or detached**: the decision keeps its copy, marked "retracted since" or "detached since" when shown.
- **Notes on a Closed investigation**: allowed, so that follow-up stays with the case.
- **Concurrent changes**: refused as conflicts (Story 2, scenario 8; Story 4, scenario 4). Notes never conflict.
- **Deleted data**: investigations, pins, unpins, decisions, notes and history are never deleted.
- **Unauthenticated caller**: refused on every investigation request.
- **Nonexistent investigation, pin, decision, entity or exception**: refused as not found or as a validation error naming the field. Malformed identifiers and invalid filters are refused with a validation error.

## Requirements *(mandatory)*

### Functional Requirements

**Investigation record**

- **FR-001**: System MUST store investigations with:
  - a unique, sequential, human-readable number shown as "INV-" followed by the number;
  - a title (1 to 200 characters), phrased as the question, and an optional description (up to 4,000 characters);
  - one **focus entity**, set at creation and never changed;
  - a **severity**: Critical, High, Medium or Low;
  - a **status**: Open, Resolved or Closed;
  - an **owner**: one user;
  - how it was created (from the Investigations area, from an entity page, or by the seed), who created it and when, and the time of its last change;
  - the resolution (who, when, summary) and closure (who, when) details, a reopen count, and a version used to detect conflicting changes.
- **FR-002**: Defaults at creation: status Open; owner the creator unless another active user is chosen.

**Creation**

- **FR-003**: Any signed-in user MUST be able to create an investigation from the Investigations area or from any entity's page. Title, severity and focus entity are required.
- **FR-004**: When "Pin the current root cause and impact" is chosen (the default), creation MUST take a root-cause pin and an impact pin by the rules of FR-010 to FR-012, at the creation time, and store them with the investigation in one step.
- **FR-005**: The creation form MUST pre-fill a **suggested title** from the focus entity, which the user MAY change:
  - when its state is unsatisfied (Pending, Waiting, Blocked, Missing, Delayed, Failed, Cancelled, Suspended) or At risk: "Why is <display name> <state in lower-case words>?", for example "Why is Order #18492 blocked?";
  - otherwise: "Investigation of <display name>".
- **FR-006**: When the focus entity is already the focus of Open or Resolved investigations, the form MUST list them (number, title, status, owner) before submission. Creation MUST still be allowed.

**Pins**

- **FR-007**: A **pin** is a stored, unchangeable copy of a root-cause result (feature 005) or an impact result (feature 006), with its kind, the time it was taken, the user who pinned it (or the system), and the entity it was computed for. Pins MUST NOT be edited or deleted.
- **FR-008**: A contributor (FR-020) MUST be able to pin while the investigation is Open or Resolved. OpsGraph MUST compute the result again at pin time; it MUST NOT accept a result from the user's screen.
- **FR-009**: A contributor MUST be able to **unpin** a pin with a reason (1 to 500 characters). An unpinned pin stays listed with who, when and why. The **current pin** of each kind is the most recently taken pin of that kind that is not unpinned, or none.
- **FR-010**: A **root-cause pin** MUST be computed for the focus entity at the default depth, or a depth from 1 to 10 chosen by the user, evaluated at the pin time, and MUST record:
  - the analysis status (root causes found, not blocked, unexplained) and summary;
  - every candidate's label, root-cause entity and confidence;
  - which candidate was chosen and why: **selected** by the user (it MUST be a current candidate, otherwise the pin is refused with a validation error), or **first-ranked**;
  - for the chosen candidate: its headline, overall confidence, every confidence rule outcome with its reason, its chain sentences, its **chain steps** (entity, state and roles: symptom, immediate blocker, upstream cause, root cause), and its key evidence records with source system, source identifier and observation time.
- **FR-011**: An **impact pin** MUST be computed at the default depth, or a chosen depth from 1 to 10, for its **anchor**, and MUST record the anchor and its role (root cause or focus), the summary sentences, the category counts (total, current, potential), the exposure per currency (total, current, potential, and the share reached only through inferred or manual links), and whether the figures are lower bounds.
- **FR-012**: The impact anchor MUST be:
  - **root cause**: the root-cause entity of the current root-cause pin; refused when there is none;
  - **focus**: the focus entity;
  - when the user does not choose: root cause if the current root-cause pin names one, otherwise focus.
- **FR-013**: Pins MUST use the same stored content, rules and wording as the root-cause and impact snapshots of feature 007, so that a result pinned to an investigation and a result frozen on an exception read the same.
- **FR-014**: The Overview of an investigation that is not Closed MUST compare its current pins with the live analyses (the live root cause of the focus entity, and the live impact of the current impact pin's anchor) and list every difference in root-cause label, root-cause entity, confidence, customer-order count, customer count, SLA commitments at risk and exposure per currency, or state that they match.

**Scope and related entities**

- **FR-015**: The **scope** of an investigation MUST be computed, never stored as a list, as the union of:
  - the focus entity (reason **Focus**);
  - the chain step entities of the current root-cause pin's chosen candidate (reason **On the pinned root-cause chain**, with the step's role);
  - the anchor of the current impact pin (reason **Anchor of the pinned impact**);
  - the subject and root-cause entity of each linked exception (reasons **Subject of EX-n**, **Root cause of EX-n**);
  - entities added by users (reason **Added by <user>**).

  Each scope entity MUST list all its reasons. The scope MUST hold at most 100 entities.
- **FR-016**: Contributors MUST be able to add an entity to the scope (at most 40 added entities) and remove an entity they or others added. An entity that is in scope for another reason stays in scope when its "added" reason is removed. Adding an entity already added is refused.
- **FR-017**: The Related Entities tab MUST list the scope (focus first, then by type and name) with type, live state and reasons, and the focus entity's direct neighbors with an **Add** action for those not yet added.

**Status and transitions**

- **FR-018**: Status MUST change only through these actions; every other action/status combination MUST be refused with a message naming the current status and the actions allowed from it:

  | Action | From | To | Required input |
  |---|---|---|---|
  | Resolve | Open | Resolved | resolution summary, 1 to 2,000 characters |
  | Close | Resolved | Closed | no linked exception is unresolved (feature 007: Open, In progress, Waiting or Reopened) |
  | Reopen | Resolved, Closed | Open | reopen reason, 1 to 500 characters |

  Reopening clears the resolution and closure details from the investigation (they stay in its history) and increases its reopen count by one.
- **FR-019**: While an investigation is Closed, only notes and Reopen MUST be accepted. Edits, owner changes, pins, unpins, scope changes, exception links and decisions MUST be refused until it is reopened.

**Ownership, editing and permissions**

- **FR-020**: Permissions MUST be enforced by the system as follows. "Contributor" means the owner, the creator, an Operations Manager or an Administrator.

  | Action | Allowed for |
  |---|---|
  | View, list, timeline, history, decisions, notes | every signed-in user |
  | Create; add a note | every signed-in user |
  | Edit title, description, severity | contributors |
  | Change owner | the owner, Operations Managers, Administrators |
  | Pin, unpin, add or remove scope entities, link or unlink exceptions, record a decision | contributors |
  | Resolve, Close | the owner, Operations Managers, Administrators |
  | Reopen | contributors |

  A refused action MUST change nothing and MUST be audited as a refusal. The investigation detail MUST state which actions the signed-in user may take, so the interface shows only those.
- **FR-021**: Every change to the investigation itself (edit, owner change, status change, pin, unpin) and every decision MUST carry the version the user last saw; a request based on an older version MUST be refused as a conflict naming the current version. Notes, scope additions and exception links MUST NOT conflict. Owners MUST be active users.

**Decisions and notes**

- **FR-022**: A **decision** MUST have a statement (1 to 500 characters), a rationale (1 to 4,000 characters), an author, a time, an optional superseded decision, and a frozen **context** as in Story 4, scenario 1, including up to 20 cited evidence items that pass the rules of Story 4, scenario 2. Decisions MUST NOT be edited or deleted. A decision MAY be superseded once, by a later decision of the same investigation. Decisions are listed newest first, paginated.
- **FR-023**: A **note** MUST have 1 to 4,000 characters, an author and a time. Notes MUST NOT be edited or deleted. Notes are listed newest first, paginated.

**Investigations list**

- **FR-024**: The Investigations list MUST offer:
  - the quick views of Story 6, scenario 1, defaulting to **Open**;
  - filters, combinable: status (several), severity (several), owner (me, a given user), an involved entity (in the scope through focus, an added entity, the current root-cause pin's root cause or a linked exception's subject or root cause), and a search by number or title words;
  - sorts, each with a fixed tie-break by number: **Recently updated** (default), last change time, newest first; **Newest**: creation time, newest first; **Severity**: Critical first, then last change time, newest first;
  - an evaluation time for SLA risk and recurrence, defaulting to the request time;
  - pagination with a default page size of 50 and a maximum of 200, with the total stated;
  - the view, filters and sort reflected in the page address.
- **FR-025**: Each list row MUST show the number, title, focus entity, severity, status, owner (marked if deactivated), the current root-cause pin's label and confidence (or "not pinned" / "no root cause"), the current impact pin's customer orders, customers and exposure, an SLA indicator (SLA commitments at risk from the pin, and the worst SLA status of the linked unresolved exceptions), the count of unresolved linked exceptions, the recurrence statement when it applies, and the created and last-change times.

**Workspace tabs**

- **FR-026**: The investigation page MUST have the tabs Overview, Graph, Root Cause, Impact, Timeline, Related Entities, Evidence, Actions, Decisions, Notes and History, with the open tab kept in the page address. Each tab MUST load and fail independently.
- **FR-027**: The **Overview** MUST show the elements of Story 1, scenario 1, and Story 2, scenario 5. Pinned values MUST be labeled with their pin time; live values MUST be labeled live.
- **FR-028**: The **Graph** tab MUST show feature 004's explorer focused on the focus entity, with blocker highlighting on and its textual list, and offer **Add to investigation** for a selected entity.
- **FR-029**: The **Root Cause** and **Impact** tabs MUST show the live analyses of features 005 and 006 as on the Entity 360 page, with **Pin** actions, and the list of every pin of that kind (current first, then newest first; unpinned ones marked), each expandable to its full stored content.
- **FR-030**: The **Timeline** tab MUST merge the events and state changes of every scope entity, oldest first, each event once, with the filters of Story 3, scenario 6, and pagination without gaps or repeats.
- **FR-031**: The **Evidence** tab MUST list, each labeled with where it comes from: the key evidence of the current root-cause pin ("pinned root cause"), the evidence cited by decisions ("cited in decision"), and the active and detached evidence items of linked exceptions ("from EX-n"). It MUST link to each scope entity's source records and evidence notes.
- **FR-032**: The **Actions** tab MUST show Story 5, scenario 1, with **Link exception**, **Unlink** and **Create exception** actions for contributors.
- **FR-033**: Every graph view in the workspace MUST be paired with a textual list and explanation (Product Overview §3, §45). This feature MUST NOT add a new graph view.

**Audit and history**

- **FR-034**: Every change to an investigation, its pins, unpins, added entities, exception links, decisions and notes MUST write one audit record, atomically with the change, holding the actor, action, target, time, and the before and after values of every changed field, plus the reason or summary given. An action refused for lack of permission MUST write a refusal record and no change record.
- **FR-035**: The **History** tab MUST list the investigation's audit records, oldest first and paginated, each with actor, time, a fixed-template sentence and every changed field with its before and after values. It MUST be visible to every signed-in user.
- **FR-036**: Investigations, pins, unpins, decisions and notes MUST never be deleted.

**Entity 360 integration**

- **FR-037**: Every Entity 360 page MUST offer **Start investigation** with the entity as focus, and show an **Investigations** section listing the investigations whose scope includes the entity (Story 6, scenario 5). When none exist, the section is a single line.

**Seed data**

- **FR-038**: The seed MUST add, idempotently, the **§39 reference investigation**: title "Why is Order #18492 delayed?", focus Order #18492, severity Critical, owner the seeded Operations Analyst, created by the system, with a root-cause pin of Order #18492 evaluated at 2026-09-29T16:00:00Z ("Budget Code Missing", HIGH), an impact pin anchored on Budget code for Order #18492 (17 customer orders, 4 customers, 3 SLA commitments at risk, 31,400.00 USD), and the §16 reference exception EX-10001 linked. The §39 and §40 datasets and the feature 007 seed MUST remain unchanged.

**Access, contracts and tests**

- **FR-039**: Unauthenticated callers MUST be refused on every new capability. Every new request and response payload MUST be defined once as a shared, validated schema used by the backend and the web app. Every new endpoint MUST have end-to-end tests for its success path, authentication failure, validation failure and, where it applies, permission refusal and conflict. Existing capabilities MUST be reused for live analyses, entity search, source records, evidence notes and exceptions.
- **FR-040**: Automated tests MUST cover at least:
  - every action from every status (3 × 3) against FR-018;
  - every row of FR-020 for the owner, the creator, a non-contributor Analyst, an Operations Manager and an Administrator;
  - pins: choice of candidate, anchor rule, stored content, current-pin rule after unpin, unchanged content after a data change;
  - scope reasons and the timeline merge, filters and paging;
  - decision context and cited-evidence rules;
  - every quick view, filter and sort of FR-024, including the SLA-risk and recurrence rules at their boundaries;
  - an audit record with before and after for every mutation, a history that matches the audit trail, and version conflicts;
  - Stories 1 to 6 against the seeded reference scenario.

### Key Entities

- **Investigation**: a persistent workspace about one focus entity. Number, title, description, severity, status, owner, focus entity, creation origin, creator, resolution and closure details, reopen count, version, current pins.
- **Pin**: a frozen root-cause or impact result attached to an investigation, with time, author and anchor. Shares its content and storage with feature 007's analysis snapshots.
- **Unpin**: who unpinned a pin, when and why.
- **Added Entity**: an entity a user added to an investigation's scope, with who and when.
- **Exception Link**: a feature 007 exception linked to an investigation, with who and when.
- **Scope Entity**: an entity in an investigation's scope with its reasons. Computed, not stored.
- **Decision**: a statement and rationale by a user, with time, an optional superseded decision and a frozen context of the evidence visible at that time.
- **Note**: immutable text by a user on an investigation.
- **History Entry**: an audit record about an investigation, presented with a sentence and field changes. Not stored separately.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Starting from Order #18492's Entity 360 page, a signed-in user creates an investigation with pinned root cause and impact and sees its Overview in under 30 seconds.
- **SC-002**: On the seeded reference investigation, the Overview shows current state BLOCKED, root cause "Budget Code Missing" (HIGH), immediate blocker Payment PAY-88213, 17 customer orders, 4 customers, 3 SLA commitments at risk and 31,400.00 USD exposure, matching Product Overview §39.
- **SC-003**: After any later change to the graph, 100% of pins and decision contexts read exactly as they did when stored, verified by automated tests that change the data after pinning.
- **SC-004**: 100% of mutations write exactly one audit record with before and after values, and 100% of an investigation's audit records appear in its History tab in order, verified by automated tests.
- **SC-005**: With 10,000 investigations stored, the first page of every quick view, filter and sort of the Investigations list returns in under 1 second at the 95th percentile over 20 runs, an investigation's Overview shows its pinned content in under 2 seconds, and the first timeline page of a 100-entity scope returns in under 1 second.
- **SC-006**: From the Investigations list, a user identifies each investigation's owner, status, pinned root cause and impact without opening it, for 100% of rows.
- **SC-007**: 100 consecutive list or timeline requests with the same filters, sort and evaluation time against unchanged data return identical results.

## Assumptions

- **Scope boundaries**: Out of scope, for later features:
  - risk detection and scoring (§14, §15) and the Risks tab of §23; the Overview shows SLA commitments at risk from the impact analysis only;
  - what-if analysis (§13), recommended actions and decision support (§33), workflows and automation (§17, §56);
  - parsing the question text to find the entity (§57): the user picks the focus entity;
  - notifications about investigations (assignment, decisions); feature 007's notifications stay exception-only;
  - teams as investigation owners: an investigation is led by one person, and team work is tracked through linked exceptions;
  - attaching files or new evidence to an investigation directly: evidence is added as feature 005 evidence notes on entities, or as feature 007 exception evidence, and cited in decisions;
  - editing or deleting notes and decisions; row-level visibility (every signed-in user sees every investigation);
  - historical graph replay (§22 "history inspection"): pins preserve results, not whole graph states.
- **One focus entity**: §9 starts from a question "about" an entity, and every analysis needs one. A question that mentions no entity cannot be analyzed, so the focus entity is required, picked by search. It never changes, so pins and history stay comparable.
- **Owner is a user**: §48 lists one owner. Teams own exceptions (feature 007); investigations are led by one person, defaulting to the creator.
- **Status set**: Open, Resolved, Closed, as described. No separate Verified status: verification of outcomes happens on linked exceptions (feature 007's four-eyes verification), and Close requires every linked exception to be resolved. Resolving with unresolved exceptions is allowed because the investigation's question may be answered before the work is done.
- **Pinning at creation by default**: a new investigation starts with a record of what was known when it was opened, as feature 007 does for exceptions. The user may opt out.
- **Pins are computed by the server at pin time**, never copied from the screen, so they cannot be forged. If the data changed between viewing and pinning, the pin shows the newer result with its time; a selected root cause that disappeared is refused (Story 2, scenario 2).
- **Root-cause pins evaluate at the pin time**: users cannot pin "as of" another time. Only the seed pins at a fixed time, so that the reference investigation keeps HIGH confidence (feature 005's evaluation-time rule).
- **Impact anchor**: as in feature 007, the impact is computed for the root-cause entity when one exists, because that reproduces §39's figures (17 orders, 4 customers, 31,400 USD). Order #18492's own downstream impact (16 orders, 18,920.00 USD) leaves out the order itself; the user can pin it with the anchor **focus**.
- **Immediate blocker**: follows feature 005 (the first step after the symptom), so for Order #18492 it is Payment PAY-88213, not Finance approval as written in §39.
- **SLA risk**: investigations have no SLA of their own. "SLA risk" means an SLA commitment (SLA entity) currently affected according to the pinned impact, or a linked exception at risk of missing or having missed its own SLA (feature 007's rule).
- **Recurring root cause**: §32 and §44 describe the same cause recurring across different cases. A root cause is recurring when its label (feature 005's operational label, such as "Budget Code Missing") was recorded on at least two distinct root-cause entities within 30 days, counting investigation pins and exception snapshots. The same root-cause entity seen by several cases is one problem, not a recurrence. The 30-day window and the "two distinct entities" threshold are fixed, published rules, not scores.
- **Scope is computed**: entities enter the scope only through the focus, the current pins, linked exceptions and explicit additions, each shown as a reason, so a user can always tell why an entity is there. Impact results are not added to the scope wholesale, because they can hold thousands of entities.
- **Decisions and conflicts**: a decision is refused when the investigation changed since the author loaded it, so its frozen context is always what the author saw. Notes never conflict.
- **Reused capabilities**: the live analyses (features 004, 005, 006), entity search, source records, evidence notes, exception creation and exception data are reused unchanged. New capabilities are limited to investigations themselves, their pins, scope additions and exception links, decisions and notes, plus two read views that cannot be served by existing capabilities without one request per entity: the merged timeline and the history.
- **Numbers**: investigation numbers start at 10001 and increase by one. They are never reused.
- **Dependencies on features 004 to 007**: this feature reuses their analyses, explorer, exception data and snapshot rules, and all four must be implemented first.
