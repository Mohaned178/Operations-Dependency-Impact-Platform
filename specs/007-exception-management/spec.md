# Feature Specification: Exception Management and Ownership

**Feature Branch**: `007-exception-management`
**Created**: 2026-10-07
**Status**: Draft
**Input**: User description: "Exception management and ownership (Product Overview §16, §35, §49). An Exception is a structured operational case: title, type (blocked order, failed payment, shipment delay, missing approval, data inconsistency, SLA risk), severity (Critical/High/Medium/Low), priority, status (Open, In Progress, Waiting, Resolved, Verified, Closed, Reopened — with an explicit allowed-transition table), owner (user or team), linked entities, root cause (from feature 005 when available), impact snapshot (from 006), SLA due time, comments, evidence, and full history. Users can create exceptions manually or from an entity/root-cause view, assign/reassign, escalate (raises severity and notifies the new owner in-app), comment, resolve with a resolution note, verify, and reopen. Introduce Teams (name, members) for team ownership. Exceptions list with filters (open, critical, assigned to me, my team, SLA at risk, unresolved) and sorting. Every change is audited with before/after and shown in the exception's history tab. In-app notifications only (no email yet)."

## Overview

Features 003 to 006 answer "What is blocking this?", "Why?" and "What is affected?". They do not answer the question that follows in every real operation (§35, §65 question 9): **"Who owns this problem, and what is being done about it?"** Today an analyst who finds that a missing budget code is holding up 17 orders has nowhere to record it, nobody to hand it to, and no way to tell later whether it was fixed.

This feature turns an operational problem into an **exception**: a structured case with an owner, a severity, a status and a deadline (Product Overview §16). The §16 example becomes real:

> **EX-10001 · Shipment SHP-77120 (consolidated) Delayed** · Shipment delay
> Severity **Critical** · Priority **P1** · Status **Open** · Owner **Finance Operations**
> SLA: due in 4 hours
> Root cause: **Budget Code Missing** (as analyzed when the exception was created)
> Impact: 17 customer orders, 4 customers, 3 SLA commitments at risk, **31,400.00 USD** exposed

An exception records:
- what the problem is: title, type, description, and the entities it concerns;
- how serious and urgent it is: severity, priority and an SLA due time;
- why it happened and what it affects: a **root-cause snapshot** (feature 005) and an **impact snapshot** (feature 006), frozen at the time they were taken, so that the case keeps the evidence available when decisions were made (§37);
- who is responsible: an owner, who is either a user or a **team**;
- where it stands: a status that moves only along an explicit **allowed-transition table**, from Open to Closed, with Reopened for problems that come back;
- the conversation and proof: comments and evidence items;
- the full history: every change, with who, when, before and after.

Users create exceptions by hand, from any entity's page, or from a root-cause analysis. They assign and reassign them, escalate them (which raises severity and notifies the owner in-app), comment, attach evidence, resolve with a resolution note, verify the resolution, close and reopen. An **Exceptions** area lists every exception with quick views (Open, Critical, Assigned to me, My teams, SLA at risk, Unresolved), filters and sorting.

The feature adds **teams** (a name and members) so that work can be owned by a group such as Finance Operations, and **in-app notifications** so that the new owner learns about an assignment or escalation.

It does **not** deliver email or chat notifications, automated exception detection, workflows or automated actions (§17, §56), risk scoring, investigations, or SLA tracking of customer contracts (§36). Those are later features.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn a root-cause finding into an owned exception (Priority: P1)

An Operations Analyst opens Shipment SHP-77120 (consolidated), which is DELAYED. Its Root cause section names **Budget Code Missing**. The analyst selects **Create exception** on that root cause. A form opens, pre-filled from the analysis:

- type **Shipment delay** and title **"Shipment SHP-77120 (consolidated) Delayed"**, both suggested by fixed rules (FR-006) and editable;
- the shipment as the exception's **subject** and the budget code as its **root-cause entity**.

The analyst chooses severity **Critical** and owner **Finance Operations**, adds a description, and submits. The exception **EX-10001** is created with status **Open**, priority **P1** (from its severity) and an SLA due time 4 hours after creation. Its page shows, with the time each was taken:

- the root-cause snapshot: the label, the confidence with its reasons, the causal chain sentences and the key evidence records;
- the impact snapshot of the root-cause entity: 17 customer orders, 4 customers, 1 shipment, 3 SLA commitments currently affected, 31,400.00 USD exposed.

Every member of Finance Operations except the analyst receives an in-app notification of the assignment.

**Why this priority**: A finding that nobody owns is not acted on. This is the step that connects understanding (features 003 to 006) to responsibility (§35), and it reproduces the §16 example on the §39 reference scenario.

**Independent Test**: Seed the reference scenario. Sign in as the Analyst, create the exception from Shipment SHP-77120's root-cause section, and compare the exception page, the linked entities, the audit trail and the notifications against the scenarios below.

**Acceptance Scenarios**:

1. **Given** the seeded reference scenario, **When** an exception is created from the root-cause candidate "Budget Code Missing" of Shipment SHP-77120 with severity Critical and owner Finance Operations, **Then**:
   - it has the next exception number, status Open, priority P1 and an SLA due time exactly 4 hours after its creation time;
   - its subject is Shipment SHP-77120 and its root-cause entity is Budget code for Order #18492, both shown as linked entities with those roles;
   - its root-cause snapshot names "Budget Code Missing", the analysis time, the overall confidence with every confidence reason, the chain sentences and the key evidence records (Contract CON-3982, Payment PAY-88213, Finance approval APR-2291 among them);
   - its impact snapshot is computed for Budget code for Order #18492 and reports 17 customer orders, 4 customers, 3 current SLA commitments and 31,400.00 USD current exposure, with the snapshot time and the entity it was computed for.
2. **Given** the same creation, **When** the audit trail and notifications are checked, **Then** one "exception created" record holds the full initial values, and each active Finance Operations member other than the creator has one unread notification naming the exception and the creator.
3. **Given** any entity page, **When** **Create exception** is selected from its header, **Then** the form is pre-filled with that entity as subject and the suggested type and title (FR-006). On submission, the root-cause analysis of the subject is run, and its highest-ranked candidate, if any, becomes the root cause. The snapshot states how many candidates existed and that the first-ranked one was taken.
4. **Given** an entity for which the root-cause analysis finds no root cause (for example Warehouse WH-EAST-02, which is not blocked), **When** an exception is created for it, **Then** the root-cause snapshot states the analysis outcome ("not blocked" or "no recorded dependency explains this state") and names no root cause, and the impact snapshot is computed for the subject itself.
5. **Given** an entity that is already the subject of an unresolved exception, **When** a user starts creating another exception for it, **Then** the form lists the existing unresolved exceptions with their numbers, statuses and owners before submission. Creation is still allowed.
6. **Given** the Exceptions area, **When** a user selects **New exception** and picks a subject entity by search, **Then** the same form and rules apply.
7. **Given** invalid input (empty title, unknown type or severity, nonexistent subject entity, a root-cause entity that is not a current candidate for the subject, an owner that is a deactivated user or an unknown team), **When** the form is submitted, **Then** it is refused with a validation error naming the field, and nothing is stored, audited or notified.

---

### User Story 2 - Work an exception through its lifecycle (Priority: P1)

The Finance Operations manager opens EX-10001 and selects **Start work**: status becomes **In Progress**. They request the budget code from the account manager and select **Wait**, entering "Waiting for account manager to supply budget code": status becomes **Waiting**, and the reason is shown on the exception. The code arrives; they **Resume** and then **Resolve** with the note "Budget code BC-7781 supplied; approval APR-2291 released". Status becomes **Resolved**, with who resolved it and when, and the SLA is marked **met** or **missed** against its due time.

The Operations Manager, a different user, checks that the order is moving and selects **Verify**: status becomes **Verified**. They then **Close** it. A week later the shipment is delayed again for the same reason; an analyst selects **Reopen** with the reason "Budget code rejected by ERP on re-validation": status becomes **Reopened** and the case is live again, with its earlier resolution preserved in the history.

Every status change follows one published table. Anything else is refused with a message that names the current status and the allowed next actions.

**Why this priority**: Status is how a team knows what is being done (§16: status, resolution, resolution verification). Without enforced transitions, "Resolved" and "Closed" mean nothing and verification can be skipped.

**Independent Test**: For every status, attempt every action as an owner, an Operations Manager, an Administrator and an unrelated Analyst. Compare each outcome with the transition table (FR-012) and the permission table (FR-016). Then run the scenario above end to end and check the history.

**Acceptance Scenarios**:

The allowed transitions are exactly:

| Action | From | To | Required input |
|---|---|---|---|
| Start work | Open, Reopened | In Progress | the exception has an owner |
| Wait | Open, In Progress, Reopened | Waiting | the exception has an owner; a waiting reason |
| Resume | Waiting | In Progress | the exception has an owner |
| Resolve | Open, In Progress, Waiting, Reopened | Resolved | a resolution note |
| Verify | Resolved | Verified | an optional verification note |
| Close | Verified | Closed | — |
| Reopen | Resolved, Verified, Closed | Reopened | a reopen reason |

1. **Given** an exception in any status, **When** an action that is not in the table for that status is requested, **Then** it is refused, nothing changes, and the message names the current status and the actions allowed from it.
2. **Given** an Open exception with no owner, **When** Start work, Wait or Resume is requested, **Then** it is refused with a message that the exception must be assigned first.
3. **Given** an In Progress exception, **When** its owner resolves it with a resolution note, **Then** its status is Resolved, it records the resolver, the time and the note, and its SLA outcome is "met" if it was resolved at or before the due time and "missed" otherwise.
4. **Given** a Resolved exception, **When** the user who resolved it tries to verify it, **Then** it is refused: verification must be done by a different user (FR-016).
5. **Given** a Resolved exception, **When** an Operations Manager who did not resolve it verifies it, **Then** its status is Verified, with the verifier, time and optional note.
6. **Given** a Closed exception, **When** any signed-in user reopens it with a reason, **Then** its status is Reopened, the current resolution and verification are cleared from the exception (and kept in its history), the reopen count increases by one, and its SLA is again measured against its due time.
7. **Given** any successful status change, **When** the history is opened, **Then** it shows the action, the actor, the time, the status before and after, and the note or reason given.
8. **Given** two users acting on the same exception from pages loaded at the same time, **When** the second user submits a change based on the older version, **Then** it is refused as a conflict, and the user is told to reload. Neither change is lost silently.

---

### User Story 3 - Find the exceptions that need attention (Priority: P2)

An Operations Manager opens the **Exceptions** area at the start of the day. It opens on **Unresolved**, sorted by SLA due time with the most urgent first. Quick views switch the list to **Open**, **Critical**, **Assigned to me**, **My teams**, **SLA at risk** or **Unresolved**, or show **All**. Filters narrow by status, severity, type, priority, owner, SLA status and linked entity, and a search box finds an exception by number or by words in its title. Each row shows the number, title, type, severity, priority, status, owner, subject entity, SLA due time with its status, and the last update time. The view, filters and sort are kept in the page address, so a copied link shows a colleague the same list.

**Why this priority**: §49 makes the list the centre of the Exceptions area, and §47 asks "What requires attention right now?". It builds on Stories 1 and 2, which create and move the exceptions it lists.

**Independent Test**: Create a fixed set of exceptions covering every status, severity, owner kind and SLA status (with a pinned evaluation time). Check each quick view, each filter, each sort and their combinations against the expected lists.

**Acceptance Scenarios**:

1. **Given** the quick views, **When** each is selected, **Then** it lists exactly:
   - **Open**: status Open or Reopened;
   - **Critical**: severity Critical and unresolved;
   - **Assigned to me**: owned by the signed-in user and unresolved;
   - **My teams**: owned by a team the signed-in user belongs to and unresolved;
   - **SLA at risk**: unresolved, with SLA status At risk or Breached;
   - **Unresolved**: status Open, In Progress, Waiting or Reopened;
   - **All**: every exception.
2. **Given** an evaluation time, **When** SLA status is computed for an unresolved exception, **Then** it is **Breached** after the due time, **At risk** when the time remaining is at most a quarter of the SLA window (due time minus creation time), and **On track** otherwise. For a resolved, verified or closed exception it is **Met** or **Missed**. Every row states its due time and the remaining or overdue time.
3. **Given** each sort (SLA due time, severity, priority, newest created, recently updated), **When** it is applied, **Then** the order follows FR-024 and is identical on every repetition against unchanged data.
4. **Given** a list longer than one page, **When** it is paged, **Then** no exception is skipped or repeated, and each page states the total.
5. **Given** a search for "EX-10001" or for a word in a title, **When** it is applied, **Then** the matching exceptions are listed.
6. **Given** an entity page, **When** it is opened, **Then** its header states how many unresolved exceptions link the entity, and an **Exceptions** section lists them (unresolved first) with a link to the full filtered list.

---

### User Story 4 - Assign, reassign and escalate, with in-app notifications (Priority: P2)

An analyst notices that EX-10002, a Medium shipment delay owned by Warehouse Operations, now affects a key customer. They select **Escalate**, choose severity **High** and give the reason "Customer Acme Corp key account; SLA breach would trigger penalty". The severity rises to High, the priority rises to at least the High default, the SLA due time tightens if the High window ends sooner, and every member of Warehouse Operations receives a notification. Later the Operations Manager **reassigns** it to a named user; that user receives a notification.

A bell in the application header shows the number of unread notifications, refreshed at least every 30 seconds. Opening it lists the user's notifications, newest first; selecting one opens the exception and marks the notification read.

**Why this priority**: Escalation and assignment are how ownership changes hands (§16, §35). Notifications make the change visible to the new owner. It builds on Story 1's owned exceptions.

**Independent Test**: As different users, assign, reassign and escalate exceptions owned by users and by teams. Check severity, priority, SLA due time, owner, history and each recipient's notifications after each action.

**Acceptance Scenarios**:

1. **Given** an unresolved exception, **When** it is escalated with a higher severity and a reason, **Then**:
   - its severity becomes the chosen one and its escalation count increases by one;
   - its priority becomes the higher of its current priority and the default priority for the new severity;
   - its SLA due time becomes the earlier of the current due time and the escalation time plus the new severity's SLA window (FR-010);
   - the owner after escalation is notified: the user, or every active member of the team, except the user who escalated.
2. **Given** an escalation that also names a new owner, **When** it is applied, **Then** the owner changes as in an assignment and the notification goes to the new owner only.
3. **Given** a Critical exception, **When** escalation is requested without a new owner, **Then** it is refused, because severity cannot rise further and nothing would change. **Given** an escalation that leaves the exception without an owner, **Then** it is refused, because nobody would be notified.
4. **Given** an assignment or reassignment, **When** it is applied, **Then** the new owner is notified as above, the history records the previous and new owner, and assigning the current owner again changes nothing and writes nothing.
5. **Given** an unowned exception, **When** an Analyst assigns it to themselves or to a team they belong to, **Then** it succeeds. **When** they assign it to someone else, **Then** it is refused (FR-016).
6. **Given** a notification, **When** its recipient opens it, **Then** it is marked read. **When** they select "Mark all read", **Then** all their notifications are marked read. Nobody can see or mark another user's notifications.
7. **Given** a team owner with deactivated members, **When** a notification is sent, **Then** deactivated members receive nothing. **Given** an attempt to assign an exception to a deactivated user, **Then** it is refused.

---

### User Story 5 - Comment, attach evidence and read the full history (Priority: P2)

While working EX-10001, the Finance manager adds a comment: "Account manager confirms code will be issued by 14:00." An analyst attaches the ERP source record of Order #18492 as **evidence**, and another evidence note "Call with Finance, ticket FIN-4410". Later an evidence note turns out to be wrong; its author detaches it with a reason, and it stays visible as detached. The **History** tab lists every change since creation, oldest first: creation, assignment, status changes with notes, escalations with before and after severity, priority and due time, comments, evidence added and detached, linked entities, and analysis refreshes, each with actor and time.

**Why this priority**: §16 and §37 require comments, evidence and history; the history is how a later reader learns what was known and decided. It enriches exceptions that Stories 1 and 2 create.

**Independent Test**: Perform one of each mutation on an exception, then compare the History tab, the audit trail and the Comments and Evidence tabs with the actions taken.

**Acceptance Scenarios**:

1. **Given** an exception in any status, **When** a signed-in user adds a comment of 1 to 4,000 characters, **Then** it is shown with author and time, newest last, and it cannot be edited or deleted.
2. **Given** an exception that is not Closed, **When** a user attaches a source record of any entity as evidence, **Then** the evidence shows the record's source system, source identifier, observation time and the entity it belongs to, labeled as source evidence. **When** a user attaches an evidence note (text and optional reference), **Then** it is labeled as manual evidence with author and time.
3. **Given** an evidence item, **When** its author, the exception's owner, an Operations Manager or an Administrator detaches it with a reason, **Then** it remains listed as detached with who, when and why. Anyone else is refused.
4. **Given** an exception with a root-cause snapshot, **When** its Evidence tab is opened, **Then** the snapshot's key evidence records are listed as "from root-cause analysis" alongside attached evidence.
5. **Given** an exception, **When** a user links another entity to it as related, **Then** the entity appears in its linked entities, and the exception appears on that entity's page. The subject cannot be unlinked, and the root-cause entity changes only through an analysis refresh.
6. **Given** an unresolved exception, **When** a contributor selects **Refresh analysis**, **Then** new root-cause and impact snapshots are taken and shown as current. The previous snapshots stay available in the history, with their times and their key figures.
7. **Given** any change made to an exception, **When** the History tab is opened, **Then** exactly one entry exists for it, in the order the changes were made, showing actor, time, action, and every changed field with its before and after values. The entries are the audit records themselves, not a separate copy.

---

### User Story 6 - Manage teams (Priority: P3)

An Administrator creates the team **Finance Operations** with a description and adds the Operations Manager and two analysts as members. Later they rename the team and remove a member. Every signed-in user can see the teams and their members, and choose a team as an exception owner.

**Why this priority**: Team ownership (§35) needs teams to exist. The seed provides two teams, so Stories 1 to 5 work without this story; administration matters once real teams change.

**Independent Test**: As an Administrator, create, rename and change the membership of a team. Check the audit trail, the owner choices in the exception form, and the "My teams" view of affected users. As an Analyst, check that every team-management action is refused.

**Acceptance Scenarios**:

1. **Given** an Administrator, **When** they create a team with a unique name (1 to 100 characters, uniqueness ignoring case) and an optional description, **Then** it is stored and audited. A duplicate name is refused.
2. **Given** a team, **When** an Administrator adds or removes a member, **Then** the membership changes and is audited. Adding an existing member or removing a non-member changes nothing.
3. **Given** a user removed from a team, **When** they open "My teams", **Then** exceptions owned by that team no longer appear. Exceptions keep their team owner.
4. **Given** a non-Administrator, **When** they try to create, rename or change the membership of a team, **Then** it is refused and the refusal is audited.
5. **Given** any signed-in user, **When** they choose an owner in an exception form, **Then** they can search active users and teams by name.

---

### Edge Cases

- **No root cause available**: the root-cause analysis may return "not blocked" or "no recorded dependency explains this state", or the subject may be satisfied. The snapshot records that outcome and names no root cause (Story 1, scenario 4).
- **Low-confidence root cause**: the snapshot keeps the analysis heading "Possible root cause — insufficient evidence" and its reasons. The exception page never presents it as a confirmed cause.
- **Several root-cause candidates**: the chosen candidate is the one the user selected on the root-cause view, otherwise the first-ranked. The snapshot lists every candidate's label and confidence and marks the chosen one.
- **Root cause no longer a candidate**: if the data changed between viewing the analysis and submitting, the root-cause entity may no longer be a candidate. Creation is refused with a validation error, and the user can retry.
- **Impact is a lower bound**: when the impact analysis hit its depth or exploration limit, the snapshot keeps the "at least" wording.
- **Snapshots are history**: snapshots do not change when the underlying data changes. The exception page links to the subject's live Entity 360 page for the current analysis. Snapshots cannot be refreshed once the exception is Resolved, Verified or Closed.
- **Owner deactivated after assignment**: ownership is kept, the owner is shown as deactivated, and the exception appears in the "SLA at risk" or "Unresolved" views as usual. A manager can reassign it.
- **Team with no active members**: it can own exceptions; the assignment form warns that nobody will be notified.
- **Self-assignment**: the actor is never notified of their own action.
- **Escalating a Critical exception**: only possible together with a new owner (Story 4, scenario 3).
- **Reassignment during Waiting**: allowed. The status stays Waiting.
- **Resolving without an owner**: allowed only for Operations Managers and Administrators (FR-016).
- **SLA due time edited into the past**: allowed for Operations Managers and Administrators; the exception becomes Breached immediately, and the history records the change.
- **Reopen after the SLA due time**: the SLA status is Breached at once; a manager can set a new due time.
- **Comments on a Closed exception**: allowed, so that follow-up remains with the case. Other changes to a Closed exception require reopening.
- **Concurrent changes**: refused as conflicts (Story 2, scenario 8). Comments and evidence do not conflict with each other.
- **Large lists**: a linked entity with hundreds of exceptions shows them paginated. An exception holds at most 50 linked entities, 100 active evidence items and any number of comments, paginated.
- **Deleted data**: exceptions, comments, evidence, snapshots and history are never deleted.
- **Unauthenticated caller**: refused on every exception, team and notification request.
- **Nonexistent exception, team or notification**: refused as not found. Malformed identifiers and invalid filters are refused with a validation error naming the field.

## Requirements *(mandatory)*

### Functional Requirements

**Exception record**

- **FR-001**: System MUST store exceptions with:
  - a unique, sequential, human-readable number shown as "EX-" followed by the number;
  - a title (1 to 200 characters) and an optional description (up to 4,000 characters);
  - a **type**: Blocked order, Failed payment, Shipment delay, Missing approval, Data inconsistency or SLA risk;
  - a **severity**: Critical, High, Medium or Low;
  - a **priority**: P1, P2, P3 or P4;
  - a **status** (FR-012);
  - an optional **owner**: one user or one team, never both;
  - one **subject entity**, set at creation and never changed;
  - an **SLA due time**;
  - how it was created (from the Exceptions area, from an entity page, from a root-cause analysis, or by the seed), who created it and when;
  - the resolution, verification and waiting details of FR-013;
  - an escalation count, a reopen count and a version used to detect conflicting changes.
- **FR-002**: Each exception MUST have **linked entities**, each with a role:
  - **Subject**: exactly one, the subject entity;
  - **Root cause**: the root-cause entity of the current root-cause snapshot, if any;
  - **Related**: entities linked by users, with who linked them and when.

  An exception MUST have at most 50 linked entities. The same entity MUST NOT be linked twice to one exception.
- **FR-003**: Defaults at creation:
  - priority from severity: Critical → P1, High → P2, Medium → P3, Low → P4, unless the creator chose one;
  - SLA due time = creation time + the severity's **SLA window**: Critical 4 hours, High 24 hours, Medium 72 hours, Low 168 hours, unless an Operations Manager or Administrator chose another time;
  - status Open.

**Creation and snapshots**

- **FR-004**: Any signed-in user MUST be able to create an exception from the Exceptions area, from any entity's page, or from a root-cause candidate on an entity's page. Title, type, severity and subject are required. Owner, description and priority are optional.
- **FR-005**: On creation, System MUST take a **root-cause snapshot** of the subject using feature 005's analysis at the default depth, evaluated at the creation time:
  - when the creator named a root-cause entity, it MUST be one of the analysis's current candidates, otherwise creation is refused with a validation error on that field;
  - otherwise the first-ranked candidate is chosen, if any;
  - the snapshot MUST record the analysis status, every candidate's label, root-cause entity and confidence, which candidate was chosen and why (selected by the user, or first-ranked), and for the chosen candidate: its headline, overall confidence, every confidence rule outcome with its reason, its chain sentences and its key evidence records with source system, source identifier and observation time;
  - when there is no candidate, the snapshot MUST record the analysis summary and name no root cause.
- **FR-006**: The creation form MUST pre-fill a **suggested type and title** from the subject, by these fixed rules, and the user MAY change them:

  | Subject type | Subject state | Suggested type |
  |---|---|---|
  | Order | BLOCKED, WAITING or PENDING | Blocked order |
  | Payment | FAILED | Failed payment |
  | Shipment | DELAYED, BLOCKED or WAITING | Shipment delay |
  | Approval or BudgetRequirement | MISSING, BLOCKED or PENDING | Missing approval |
  | SLA | AT_RISK | SLA risk |
  | any other combination | — | none: the user chooses |

  The suggested title is the subject's display name followed by its state in words (for example "Shipment SHP-77120 (consolidated) Delayed").
- **FR-007**: On creation, System MUST take an **impact snapshot** using feature 006's analysis at the default depth, computed for the **impact anchor**: the chosen root-cause entity when there is one, otherwise the subject. The snapshot MUST record the anchor, the time, the summary sentences, the headline category counts (total, current, potential), the other non-zero categories, the exposure per currency (total, current, potential and the share reached only through inferred or manual links), and whether the figures are lower bounds.
- **FR-008**: Snapshots MUST be stored unchanged and never edited. A contributor (FR-016) MUST be able to **refresh** both snapshots of an exception whose status is Open, In Progress, Waiting or Reopened; this adds new snapshots, which become current, updates the root-cause linked entity, and keeps the earlier ones. The exception page MUST show the current snapshots with their times and link to the subject's live Entity 360 page.
- **FR-009**: When a subject already has unresolved exceptions, the creation form MUST list them (number, title, status, owner) before submission. Creation MUST still be allowed.

**Severity, priority and SLA**

- **FR-010**: **Escalation** MUST require a reason (1 to 500 characters) and at least one of: a strictly higher severity, or a new owner. It is allowed only while the exception is Open, In Progress, Waiting or Reopened, and the exception MUST have an owner afterwards. When severity rises:
  - priority becomes the higher of the current priority and the new severity's default (FR-003);
  - the SLA due time becomes the earlier of the current due time and the escalation time plus the new severity's SLA window.

  Each escalation increases the escalation count by one and notifies the owner after escalation (FR-020).
- **FR-011**: **SLA status** MUST be computed at an evaluation time (the request time unless one is given) by these fixed rules, and each result MUST state its due time, the evaluation time and the remaining or overdue time:
  - Resolved, Verified or Closed: **Met** if resolved at or before the due time, otherwise **Missed**;
  - otherwise **Breached** if the evaluation time is after the due time;
  - otherwise **At risk** if the time remaining is at most 25% of the SLA window (due time minus creation time);
  - otherwise **On track**.

  The SLA clock does not pause in any status.

**Status and transitions**

- **FR-012**: Status MUST change only through these actions, and every other action/status combination MUST be refused with a message naming the current status and the actions allowed from it:

  | Action | From | To | Required input |
  |---|---|---|---|
  | Start work | Open, Reopened | In Progress | an owner |
  | Wait | Open, In Progress, Reopened | Waiting | an owner; waiting reason, 1 to 500 characters |
  | Resume | Waiting | In Progress | an owner |
  | Resolve | Open, In Progress, Waiting, Reopened | Resolved | resolution note, 1 to 2,000 characters |
  | Verify | Resolved | Verified | optional verification note, up to 2,000 characters |
  | Close | Verified | Closed | — |
  | Reopen | Resolved, Verified, Closed | Reopened | reopen reason, 1 to 500 characters |

  **Unresolved** means Open, In Progress, Waiting or Reopened.
- **FR-013**: The exception MUST record:
  - while Waiting, the waiting reason, which is cleared when it leaves Waiting;
  - when Resolved, the resolver, resolution time and resolution note;
  - when Verified, the verifier, verification time and optional note;
  - when Closed, who closed it and when;
  - when Reopened, the reopen count increases by one and the resolution, verification and closing details are cleared from the exception. They remain in its history.
- **FR-014**: While an exception is Closed, only comments and Reopen MUST be accepted. Edits, assignment, escalation, evidence, linking and refresh MUST be refused until it is reopened.

**Editing and concurrency**

- **FR-015**: Contributors (FR-016) MUST be able to edit the title, description, type and priority of an exception that is not Closed. Only Operations Managers and Administrators MAY change severity or the SLA due time directly, and the SLA due time only while the exception is unresolved. Every change to the exception MUST carry the version the user last saw; a change based on an older version MUST be refused as a conflict, naming the current version.

**Ownership and permissions**

- **FR-016**: Permissions MUST be enforced by the system as follows. "Owner" means the owning user, or any active member of the owning team. "Contributor" means the creator, the owner, an Operations Manager or an Administrator.

  | Action | Allowed for |
  |---|---|
  | View, list, history, comment, add evidence, link an entity | every signed-in user |
  | Create | every signed-in user |
  | Edit title, description, type, priority; refresh analysis | contributors |
  | Change severity or SLA due time directly | Operations Managers, Administrators |
  | Assign or reassign | Operations Managers and Administrators, any owner; the current owner, any owner; anyone, for an **unowned** exception, to themselves or a team they belong to |
  | Escalate | every signed-in user, when only severity changes; the assignment rules apply when the owner changes |
  | Start work, Wait, Resume | the owner, Operations Managers, Administrators |
  | Resolve | the owner, Operations Managers, Administrators |
  | Verify | Operations Managers and Administrators, except the user who resolved it |
  | Close | Operations Managers, Administrators |
  | Reopen | every signed-in user |
  | Detach evidence, unlink a related entity | the user who added it, contributors |
  | Manage teams | Administrators |
  | Read and mark notifications | the recipient only |

  A refused action MUST change nothing and MUST be audited as a refusal. The exception detail MUST state which actions the signed-in user may take, so the interface shows only those.
- **FR-017**: Exceptions MUST NOT be assignable to deactivated users. Unassigning (removing the owner) MUST be allowed only for Operations Managers and Administrators.

**Teams**

- **FR-018**: System MUST store **teams** with a name (1 to 100 characters, unique ignoring case), an optional description (up to 500 characters) and members (users). A user MAY belong to several teams. Administrators MUST be able to create teams, rename them, change their description, and add and remove members. Teams MUST NOT be deleted. Every signed-in user MUST be able to list teams with their members.
- **FR-019**: An owner directory MUST let every signed-in user search active users and teams by name when choosing an owner.

**Notifications**

- **FR-020**: System MUST create an in-app **notification** when:
  - an exception is assigned or reassigned (including at creation): for the new owner;
  - an exception is escalated: for the owner after escalation.

  For a team owner, every active member receives one. The user who performed the action and deactivated users never receive one. Each notification MUST state its kind, the exception number and title, the actor, the time and a fixed-template sentence (for example: Operations Analyst escalated EX-10002 "Shipment SHP-77125 Delayed" to HIGH: Customer Acme Corp key account; SLA breach would trigger penalty).
- **FR-021**: Each user MUST be able to list their own notifications, newest first and paginated, see their unread count, mark one read and mark all read. The application header MUST show the unread count, refreshed at least every 30 seconds while the application is open. No email or other channel is used.

**Comments, evidence and history**

- **FR-022**: Comments MUST have 1 to 4,000 characters, an author and a time. They MUST be immutable: no edit or delete. They are listed oldest first, paginated.
- **FR-023**: Evidence items MUST be either:
  - a **source record** that exists in OpsGraph, shown with its source system, source identifier, observation time and entity, and labeled as source evidence; or
  - an **evidence note** with text (1 to 2,000 characters) and an optional reference (up to 500 characters), labeled as manual evidence.

  Each has its author and time. Items MUST NOT be edited or deleted; they can be **detached** with a reason (1 to 500 characters), after which they stay visible as detached with who, when and why. At most 100 items MAY be attached and not detached at once. The Evidence tab MUST also list the current root-cause snapshot's key evidence records, marked "from root-cause analysis".

**Exceptions list**

- **FR-024**: The Exceptions list MUST offer:
  - the quick views of Story 3, scenario 1, defaulting to **Unresolved**;
  - filters, combinable: status (several), severity (several), type (several), priority (several), owner (me, my teams, unassigned, a given user, a given team), SLA status (several), a linked entity (any role), and a search by number or title words;
  - sorts, each with a fixed tie-break by number:
    - **SLA due** (default): due time, earliest first;
    - **Severity**: Critical first, then due time;
    - **Priority**: P1 first, then due time;
    - **Newest**: creation time, newest first;
    - **Recently updated**: last change time, newest first;
  - pagination with a default page size of 50 and a maximum of 200, with the total stated;
  - the view, filters and sort reflected in the page address.
- **FR-025**: Each list row MUST show number, title, type, severity, priority, status, owner (marked if deactivated), subject entity, SLA due time and SLA status, and last update time.

**Audit and history**

- **FR-026**: Every change to an exception, its comments, evidence, linked entities, snapshots and ownership, every team change and every notification read MUST write one audit record, atomically with the change, holding the actor, action, target, time, and the before and after values of every changed field, plus the note or reason given. An action refused for lack of permission MUST write a refusal record and no change record.
- **FR-027**: Each exception MUST have a **History** tab that lists the audit records of that exception, oldest first and paginated, each with actor, time, a fixed-template sentence describing the change, and every changed field with its before and after values. It MUST be visible to every signed-in user.
- **FR-028**: Exceptions, comments, evidence items, detachments, snapshots and teams MUST never be deleted.

**Entity 360 integration**

- **FR-029**: Every Entity 360 page MUST:
  - state in its header how many unresolved exceptions link the entity, linking to its Exceptions section;
  - offer **Create exception** with the entity as subject;
  - show an **Exceptions** section after Impact and before Dependencies, listing the exceptions that link the entity (unresolved first, then by SLA due time), with number, title, role of the entity, severity, status, owner and SLA status, and a link to the full filtered list. When none exist, the section is a single line.
- **FR-030**: Each root-cause candidate on the Entity 360 page MUST offer **Create exception from this root cause**, which pre-fills the form with the entity as subject and the candidate's root-cause entity.
- **FR-031**: Exception pages MUST present text, tables and lists. This feature MUST NOT add a graph view.

**Seed data**

- **FR-032**: The seed MUST add, idempotently:
  - the team **Finance Operations** with the seeded Operations Manager as member, and the team **Warehouse Operations** with the seeded Operations Analyst as member;
  - the **§16 reference exception**: subject Shipment SHP-77120, type Shipment delay, severity Critical, owner Finance Operations, created by the system from the root-cause analysis of the subject evaluated at 2026-09-29T16:00:00Z, so that its root cause is "Budget Code Missing" with HIGH confidence and its impact snapshot (anchored on Budget code for Order #18492) reports 17 customer orders, 4 customers and 31,400.00 USD.

  The §39 and §40 datasets MUST remain unchanged.

**Access, contracts and tests**

- **FR-033**: Unauthenticated callers MUST be refused on every new capability. Every new request and response payload MUST be defined once as a shared, validated schema used by the backend and the web app. Every new endpoint MUST have end-to-end tests for its success path, authentication failure, validation failure and, where it applies, permission refusal and conflict.
- **FR-034**: Automated tests MUST cover at least:
  - every action from every status (7 × 7), allowed and refused, against the table in FR-012;
  - every row of the permission table in FR-016, for an owner user, a team member, a non-member, an Operations Manager, an Administrator and the resolver;
  - the SLA rules of FR-011 at their boundaries (exactly at 25% remaining, exactly at the due time) and the escalation rules of FR-010;
  - notification recipients for user owners, team owners, self-actions and deactivated members;
  - an audit record with before and after for every mutation, and a history that matches the audit trail;
  - version conflicts;
  - every quick view, filter and sort of FR-024;
  - Stories 1 to 6 against the seeded reference scenario.

### Key Entities

- **Exception**: a structured operational case. Number, title, description, type, severity, priority, status, owner (user or team), subject entity, SLA due time, creation origin, creator, resolution, verification, waiting and closing details, escalation and reopen counts, version.
- **Exception Link**: an entity linked to an exception with a role (Subject, Root cause, Related), who linked it and when.
- **Root-Cause Snapshot**: a frozen record of feature 005's analysis of the subject at a time: status, candidates, the chosen candidate's label, confidence and reasons, chain sentences and key evidence.
- **Impact Snapshot**: a frozen record of feature 006's analysis of the impact anchor at a time: summary sentences, category counts, exposure and limits.
- **Comment**: immutable text by a user on an exception.
- **Evidence Item**: a source record or an evidence note attached to an exception, with author, time and optional detachment (who, when, why).
- **Team**: a named group of users that can own exceptions.
- **Team Membership**: a user's membership of a team.
- **Notification**: an in-app message to one user about an assignment or escalation, with its read time.
- **History Entry**: an audit record about an exception, presented with a sentence and field changes. Not stored separately.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Starting from Shipment SHP-77120's Entity 360 page, a signed-in user creates an exception with root cause, impact, owner, severity and SLA due time in under 60 seconds.
- **SC-002**: 100% of the action/status combinations in FR-012 and of the permission rows in FR-016 behave as specified, verified by automated tests over all 49 action/status pairs and every role.
- **SC-003**: 100% of mutations write exactly one audit record with before and after values, and 100% of an exception's audit records appear in its History tab in order, verified by automated tests.
- **SC-004**: A new owner sees the unread count increase within 30 seconds of being assigned or escalated to, without reloading the page.
- **SC-005**: With 10,000 exceptions stored, the first page of every quick view, filter and sort of the Exceptions list returns in under 1 second at the 95th percentile over 20 runs, and an exception's detail page shows its header and snapshots in under 2 seconds.
- **SC-006**: From the Exceptions list, a user identifies who owns an exception, its status and the time left before SLA breach without opening it, for 100% of rows.
- **SC-007**: After seeding, the reference exception shows severity Critical, owner Finance Operations, root cause "Budget Code Missing" (HIGH), 17 affected customer orders, 4 affected customers and 31,400.00 USD exposure, matching Product Overview §16 and §39.
- **SC-008**: 100 consecutive list requests with the same filters, sort and evaluation time against unchanged data return identical results.

## Assumptions

- **Scope boundaries**: Out of scope, for later features:
  - email, chat or push notifications; notifications for comments, status changes or reopening;
  - automated exception creation from risks, data-quality conflicts or rules (§31, §53);
  - workflows, actions and automation (§17, §56), including "request information" or "release shipment";
  - investigations (§23, §48) and linking exceptions to them;
  - SLA management from customer contracts (§36). The exception's SLA due time is its own resolution deadline, unrelated to the SLA entity type;
  - department and operational-function ownership (§35): teams cover both;
  - SLA pause while Waiting, business hours and holiday calendars;
  - row-level visibility: every signed-in user can see every exception;
  - attaching files or uploading documents.
- **Severity, priority and SLA windows**: severity describes how serious the problem is; priority describes the order of work, defaulting from severity. The SLA windows (Critical 4 h, matching §16; High 24 h; Medium 72 h; Low 168 h) are fixed defaults that a manager can override per exception. Configurable windows are a later refinement.
- **At-risk threshold**: an unresolved exception is "at risk" when at most 25% of its SLA window remains. This is a fixed, published rule, not a score (Constitution III).
- **Transition table**: no Withdraw or Cancel transition exists. Duplicates and false alarms are resolved with a resolution note saying so, then verified and closed, so that every closure is reviewed. Closing requires prior verification.
- **Four-eyes verification**: verification is limited to Operations Managers and Administrators, and the verifier must differ from the resolver, so that "Verified" means a second person checked the outcome (§16 "resolution verification").
- **Reopening is open to everyone**: anyone who sees a resolved problem return can reopen it with a reason; the reason and actor are audited.
- **Root cause and impact are snapshots**: §37 requires the "evidence available at the time". Snapshots are taken at creation and on explicit refresh, and live analysis stays on the Entity 360 page. Recomputing on every view would change a case's facts after decisions were made.
- **Impact anchor**: the impact snapshot is computed for the root-cause entity when one exists, because that is the problem whose resolution releases everything it holds up. For the §39 scenario this gives the §16 figures (17 orders, 4 customers, 31,400 USD); the subject shipment's own downstream impact would omit Order #18492 and the payment chain. Without a root cause, the subject is the anchor.
- **Automatic root cause on manual creation**: when the creator does not choose a candidate, the first-ranked candidate of feature 005 is taken, and the snapshot states that and lists all candidates with their confidences, so the choice is visible, not silent (Constitution II).
- **Exception numbers**: numbers start at 10001 and increase by one. They are never reused.
- **Teams are managed by Administrators**: §38 gives Administrators users, roles and permissions. Teams are never deleted, because exceptions and history refer to them; renaming keeps references valid.
- **Notifications are polled**: the header refreshes the unread count at most every 30 seconds. Real-time push is a later refinement.
- **Notification reads are audited**: the constitution requires every mutation to be audited, so marking notifications read writes an audit record (one per request).
- **Dependencies on features 005 and 006**: root-cause and impact snapshots use those features' analyses unchanged. Both must be implemented before this feature.
- **Existing foundation**: sign-in, roles, users, audit, the error format, shared schemas, the entity model, the reference seed and the Entity 360 page come from features 001 to 006 and are reused.
