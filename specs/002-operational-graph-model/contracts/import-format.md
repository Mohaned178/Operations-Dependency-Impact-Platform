# Import Format (user-facing documentation)

> **Implementer**: publish this file as `docs/import-format.md` (FR-024). Remove this note and keep the rest. Create the example files under `docs/examples/import/` (see "Example files" at the end). They MUST import cleanly into an empty database, in the order listed. An e2e test MUST import each one through `POST /api/imports` and assert `outcome = APPLIED`.

Administrators can load entities, relationships and events into OpsGraph from JSON or CSV files. Every row records where it came from: the source system, the source identifier, and when the source observed it.

## How an import behaves

- **Who**: only Administrators can import.
- **Sending a file**: `POST /api/imports` as `multipart/form-data` with these parts:
  - `file`
  - `format` (`json` or `csv`)
  - `kind` (CSV only: `entities`, `relationships` or `events`)
  - `dryRun` (`true` to validate without saving)
- **Limits**: 10 MB and 10,000 rows per import.
- **All-or-nothing**: if any row is invalid, **nothing** from the file is saved. The report lists every problem. Fix the rows and submit the whole file again.
- **Dry run**: produces the same report but saves nothing.
- **Re-submitting is safe**: rows already stored with the same content and observation time are reported as `unchanged`.
- **Nothing is discarded**: every field you send, including fields OpsGraph does not recognize, is kept in the stored raw source record.
- **No deletion**: imports never delete anything.
- **Linking records across systems**: OpsGraph never guesses that two records describe the same thing. To attach a record from a second system to an existing entity, use `entityRef` (see below).

## Values

| Field | Rules |
|---|---|
| `sourceSystem` | 1–64 characters: letters, digits, space, `_`, `.`, `-`, starting with a letter or digit. Example: `OMS`. |
| `sourceId` | 1–200 characters, and must not contain `\|`, `;` or line breaks. |
| timestamps (`observedAt`, `occurredAt`) | ISO 8601 **with a timezone**: `2026-09-29T09:12:00Z` or `2026-09-29T11:12:00+02:00`. A timestamp without a timezone is rejected, as is one more than 5 minutes in the future. |
| entity `type` | `Customer`, `Contract`, `Order`, `Product`, `Payment`, `Invoice`, `Approval`, `Warehouse`, `Shipment`, `Supplier`, `SLA`, `BudgetRequirement` |
| `state` | `ACTIVE`, `PENDING`, `WAITING`, `BLOCKED`, `MISSING`, `DELAYED`, `AT_RISK`, `COMPLETED`, `FAILED`, `CANCELLED`, `SUSPENDED`, `UNKNOWN` |
| relationship `type` | `HAS`, `PLACED`, `GOVERNS`, `CONTAINS`, `GENERATES`, `REQUIRES`, `DEPENDS_ON`, `BLOCKS`, `FULFILLED_BY`, `SUPPLIED_BY`, `DEFINES`, `RELATES_TO` |
| `origin` | `SOURCE` (the source system states it), `INFERRED` (derived by a rule) or `MANUAL` (asserted by a person) |
| `confidence` | `HIGH`, `MEDIUM`, `LOW` |
| `basis` | Required when `origin` is `INFERRED` or `MANUAL`: why the link is believed to exist, or who asserted it. 1–500 characters. |
| event `type` | Lowercase dotted name, for example `order.created` or `approval.blocked` |
| money | `attributes.amount` as a decimal **string** (`"12480.00"`), up to 4 decimal places, plus `attributes.currency` as a 3-letter code (`"USD"`). Both are required for `Order`, `Payment` and `Invoice`. |

### Which entity types each relationship type can connect

| Relationship | From | To |
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

These meanings matter for later analysis:
- "A REQUIRES B" and "A DEPENDS_ON B" mean A cannot progress without B.
- "A BLOCKS B" means A is currently preventing B.
- A relationship from an entity to itself is rejected.

## Referring to entities

Relationships, events and `entityRef` refer to entities in one of two ways:
- **by key**: `{ "entityType": "Order", "sourceSystem": "OMS", "sourceId": "18492" }`. The key can belong to an entity already in OpsGraph, or to an entity row in the same file. A row's position in the file does not matter.
- **by OpsGraph id**: `{ "id": "<uuid>" }`. The entity must already exist.

### `entityRef`

`entityRef` attaches a second system's record to an existing entity. Example: an ERP record for an order already imported from OMS. The reference must point to:
- an entity of the same type;
- either the entity's OpsGraph id, or a key that already exists or that belongs to another row in the file **that has no `entityRef` of its own**.

Chains of references are rejected.

## JSON

The document is an object with any of the sections `entities`, `relationships` and `events`. Each section is an array of rows. Any other top-level key is an error.

```json
{
  "entities": [
    {
      "type": "Order", "sourceSystem": "OMS", "sourceId": "18492",
      "displayName": "Order #18492", "observedAt": "2026-09-29T11:40:00Z",
      "state": "BLOCKED", "sourceStatus": "ON_HOLD",
      "attributes": { "amount": "12480.00", "currency": "USD" }
    },
    {
      "type": "Order", "sourceSystem": "ERP", "sourceId": "SO-18492",
      "displayName": "Order #18492", "observedAt": "2026-09-29T09:20:00Z",
      "state": "PENDING", "sourceStatus": "OPEN",
      "attributes": { "amount": "12480.00", "currency": "USD" },
      "entityRef": { "entityType": "Order", "sourceSystem": "OMS", "sourceId": "18492" }
    }
  ],
  "relationships": [
    {
      "type": "REQUIRES", "sourceSystem": "Payments", "sourceId": "REQUIRES:18492:PAY-88213",
      "from": { "entityType": "Order", "sourceSystem": "OMS", "sourceId": "18492" },
      "to": { "entityType": "Payment", "sourceSystem": "Payments", "sourceId": "PAY-88213" },
      "origin": "SOURCE", "confidence": "HIGH", "observedAt": "2026-09-29T15:00:00Z"
    }
  ],
  "events": [
    {
      "type": "order.created", "sourceSystem": "OMS", "sourceId": "EVT-OMS-1001",
      "occurredAt": "2026-09-29T09:12:00Z", "observedAt": "2026-09-29T09:13:00Z",
      "subject": { "entityType": "Order", "sourceSystem": "OMS", "sourceId": "18492" },
      "related": [{ "entityType": "Customer", "sourceSystem": "CRM", "sourceId": "CUST-1001" }],
      "description": "Order #18492 created for 12,480.00 USD"
    }
  ]
}
```

Fields: entity rows take `type`, `sourceSystem`, `sourceId`, `displayName`, `observedAt`, plus optional `state`, `sourceStatus`, `attributes` and `entityRef`. Relationship and event rows use the fields shown above, and `basis`, `related` and `description` are optional.

Row numbers in error reports are 1-based positions within each section. Fields are reported as paths such as `from.sourceId`.

## CSV

Each file holds one kind of row. Choose the kind with the `kind` part when you submit.

The rules:
- **Encoding**: UTF-8, with or without a BOM.
- **Header**: the first line is the header.
- **Empty cells** mean "not provided".
- **Unknown columns** are kept in the stored raw record, but otherwise ignored. The exception is `attr.` columns.
- **Row numbers in reports** match a spreadsheet: the header is row 1, the first data row is row 2. Fields are reported by column name.

### `entities.csv`

| Column | JSON field |
|---|---|
| `type`, `source_system`, `source_id`, `display_name`, `observed_at`, `state`, `source_status` | `type`, `sourceSystem`, `sourceId`, `displayName`, `observedAt`, `state`, `sourceStatus` |
| `attr.<name>` (any number) | `attributes.<name>` (string values) |
| `ref_id` | `entityRef.id` |
| `ref_type`, `ref_source_system`, `ref_source_id` | `entityRef.entityType`, `entityRef.sourceSystem`, `entityRef.sourceId` |

### `relationships.csv`

| Column | JSON field |
|---|---|
| `type`, `source_system`, `source_id`, `origin`, `confidence`, `basis`, `observed_at` | same names, camelCase |
| `from_id`, or `from_type` + `from_source_system` + `from_source_id` | `from` |
| `to_id`, or `to_type` + `to_source_system` + `to_source_id` | `to` |

### `events.csv`

| Column | JSON field |
|---|---|
| `type`, `source_system`, `source_id`, `occurred_at`, `observed_at`, `description` | same names, camelCase |
| `subject_id`, or `subject_type` + `subject_source_system` + `subject_source_id` | `subject` |
| `related` | `related`. A `;`-separated list where each item is either an OpsGraph id or `Type\|SourceSystem\|SourceId`, for example `Customer\|CRM\|CUST-1001;Contract\|ContractMgmt\|CON-3982` |

**Mixing reference forms**: a row that fills in both `*_id` and the key columns for the same reference is rejected: `Use either <prefix>_id or the <prefix>_type/_source_system/_source_id columns, not both`.

## The import report

Every submission returns a report with these parts:
- **`outcome`**: one of three values.
  - `APPLIED`: saved.
  - `REJECTED`: nothing saved, because of errors.
  - `DRY_RUN`: nothing saved, on purpose.
- **`counts`**: per kind, the number received, created, updated, unchanged and rejected. They always add up: received = created + updated + unchanged + rejected. When `outcome` is not `APPLIED`, `countsAreProjected` is `true` and the counts describe what *would* have happened.
- **`fileErrors`**: problems with the file as a whole, for example invalid JSON, a file that is not UTF-8, or an unknown section.
- **`rowErrors`**: one entry per problem, giving `kind`, `row`, `field` and `message`. If a row was rejected only because a row it refers to was rejected, `dependsOn` names that row.

Administrators can fetch past reports with `GET /api/imports` and `GET /api/imports/{id}`.

## Example files

Create these under `docs/examples/import/`. They form a small, self-contained dataset that is separate from the seed (source system names are prefixed `Demo`):
1. `entities.csv`: 1 Customer (`DemoCRM`), 1 Order (`DemoOMS`, with `attr.amount` and `attr.currency`), 1 Payment (`DemoPay`).
2. `relationships.csv`: Customer PLACED Order (SOURCE/HIGH); Order REQUIRES Payment (INFERRED/MEDIUM, with a `basis`).
3. `events.csv`: `order.created` on the Order, related to the Customer.
4. `import.json`: the same dataset as the three CSVs combined into one JSON document, using source ids with a `-J` suffix so it doesn't clash with them.
