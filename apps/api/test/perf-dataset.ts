import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../src/prisma/prisma.service';

/** Ids of the entities the performance specs query by name. */
export interface PerfDatasetIds {
  g0Id: string;
  g6Id: string;
  g7Id: string;
}

/**
 * The 50,000-entity, ~150,000-relationship dataset of feature 003's research R11: ten-entity
 * chains linked by DEPENDS_ON (R1), REQUIRES between neighbouring chains (R2), RELATES_TO noise
 * (R3) and hub warehouses fulfilling shipments (R4). The caller resets the database first.
 */
export async function buildPerfDataset(prisma: PrismaService): Promise<PerfDatasetIds> {
  const importId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO imports
      (id, trigger, format, dry_run, outcome, actor_type, file_name, byte_size,
        received_at, counts, file_errors, row_errors, correlation_id)
    VALUES (${importId}::uuid, 'SEED', 'JSON', false, 'APPLIED', 'system', 'perf-seed.json', 0,
      now(), '{}', '[]', '[]', ${randomUUID()}::uuid)
  `;

  // Entities: 50,000 with deterministic ids md5('perf-' || g)::uuid (research R11).
  await prisma.$executeRaw`
    INSERT INTO entities (id, type, display_name, attributes, current_state, last_observed_at, created_at, updated_at)
    SELECT md5('perf-' || g)::uuid,
      (CASE (g % 10)
        WHEN 0 THEN 'Shipment'
        WHEN 1 THEN 'Order'
        WHEN 2 THEN 'Payment'
        WHEN 3 THEN 'Approval'
        WHEN 4 THEN 'BudgetRequirement'
        WHEN 5 THEN 'Contract'
        WHEN 6 THEN 'Customer'
        WHEN 7 THEN 'Warehouse'
        WHEN 8 THEN 'Product'
        ELSE 'Supplier'
      END)::"EntityType",
      'Perf ' ||
      (CASE (g % 10)
        WHEN 0 THEN 'Shipment'
        WHEN 1 THEN 'Order'
        WHEN 2 THEN 'Payment'
        WHEN 3 THEN 'Approval'
        WHEN 4 THEN 'BudgetRequirement'
        WHEN 5 THEN 'Contract'
        WHEN 6 THEN 'Customer'
        WHEN 7 THEN 'Warehouse'
        WHEN 8 THEN 'Product'
        ELSE 'Supplier'
      END) || ' ' || g,
      '{}',
      (CASE
        WHEN (g / 10) = 0 THEN
          CASE (g % 10)
            WHEN 0 THEN 'DELAYED'
            WHEN 1 THEN 'BLOCKED'
            WHEN 2 THEN 'PENDING'
            WHEN 3 THEN 'BLOCKED'
            WHEN 4 THEN 'WAITING'
            WHEN 5 THEN 'PENDING'
            WHEN 6 THEN 'MISSING'
            ELSE 'ACTIVE'
          END
        ELSE
          CASE WHEN (g % 10) <= 2 OR ((g / 10) % 7) = 0 THEN 'PENDING' ELSE 'ACTIVE' END
      END)::"OperationalState",
      now(), now(), now()
    FROM generate_series(0, 49999) AS g
  `;

  // R1: 45,000 rows within each chain, pos p DEPENDS_ON pos p+1, HIGH.
  await prisma.$executeRaw`
    INSERT INTO relationships
      (id, type, from_entity_id, to_entity_id, origin, confidence,
        source_system, source_id, observed_at, import_id, created_at, updated_at)
    SELECT gen_random_uuid(), 'DEPENDS_ON',
      md5('perf-' || g)::uuid, md5('perf-' || (g + 1))::uuid,
      'SOURCE', 'HIGH', 'Perf', 'PERF-R1-' || g, now(), ${importId}::uuid, now(), now()
    FROM generate_series(0, 49999) AS g
    WHERE (g % 10) <= 8
  `;

  // R2: 50,000 rows, every entity REQUIRES the entity at the same pos in the next chain, MEDIUM.
  await prisma.$executeRaw`
    INSERT INTO relationships
      (id, type, from_entity_id, to_entity_id, origin, confidence,
        source_system, source_id, observed_at, import_id, created_at, updated_at)
    SELECT gen_random_uuid(), 'REQUIRES',
      md5('perf-' || g)::uuid,
      md5('perf-' || ((((g / 10) + 1) % 5000) * 10 + (g % 10)))::uuid,
      'SOURCE', 'MEDIUM', 'Perf', 'PERF-R2-' || g, now(), ${importId}::uuid, now(), now()
    FROM generate_series(0, 49999) AS g
  `;

  // R3: 50,000 rows of RELATES_TO noise that traversal must ignore.
  await prisma.$executeRaw`
    INSERT INTO relationships
      (id, type, from_entity_id, to_entity_id, origin, confidence,
        source_system, source_id, observed_at, import_id, created_at, updated_at)
    SELECT gen_random_uuid(), 'RELATES_TO',
      md5('perf-' || g)::uuid, md5('perf-' || ((g + 7919) % 50000))::uuid,
      'SOURCE', 'HIGH', 'Perf', 'PERF-R3-' || g, now(), ${importId}::uuid, now(), now()
    FROM generate_series(0, 49999) AS g
    WHERE ((g + 7919) % 50000) <> g
  `;

  // R4: 5,000 rows, every Shipment FULFILLED_BY its hub warehouse, HIGH.
  await prisma.$executeRaw`
    INSERT INTO relationships
      (id, type, from_entity_id, to_entity_id, origin, confidence,
        source_system, source_id, observed_at, import_id, created_at, updated_at)
    SELECT gen_random_uuid(), 'FULFILLED_BY',
      md5('perf-' || g)::uuid, md5('perf-' || (((g / 10) % 50) * 10 + 7))::uuid,
      'SOURCE', 'HIGH', 'Perf', 'PERF-R4-' || g, now(), ${importId}::uuid, now(), now()
    FROM generate_series(0, 49999) AS g
    WHERE (g % 10) = 0
  `;

  const g0 = await prisma.entity.findFirstOrThrow({ where: { displayName: 'Perf Shipment 0' } });
  const g6 = await prisma.entity.findFirstOrThrow({ where: { displayName: 'Perf Customer 6' } });
  const g7 = await prisma.entity.findFirstOrThrow({ where: { displayName: 'Perf Warehouse 7' } });
  return { g0Id: g0.id, g6Id: g6.id, g7Id: g7.id };
}
