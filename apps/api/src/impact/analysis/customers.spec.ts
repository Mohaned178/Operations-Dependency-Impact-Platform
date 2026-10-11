import { affected, attribution, directPath, ref } from '../../../test/impact-builders';
import { mergeCustomers } from './customers';

describe('mergeCustomers', () => {
  const start = ref('Supplier', 'Start', 'SUSPENDED');

  it('adds an attributed-only customer with no distance, INDIRECT and no path', () => {
    const order = ref('Order', 'SO-1');
    const customer = ref('Customer', 'Acme');
    const result = mergeCustomers(
      [affected(order, { classification: 'POTENTIAL' })],
      [attribution(order.id, customer)],
      start.id,
    );
    const added = result.find((item) => item.entity.id === customer.id);
    expect(added?.distance).toBeNull();
    expect(added?.directness).toBe('INDIRECT');
    expect(added?.primaryPath).toBeNull();
    expect(added?.shortestPath).toBeNull();
    expect(added?.classification).toBe('POTENTIAL');
    expect(added?.attributions).toHaveLength(1);
  });

  it('makes a customer CURRENT when any of its attributions is current', () => {
    const current = ref('Order', 'SO-1', 'BLOCKED');
    const potential = ref('Order', 'SO-2');
    const customer = ref('Customer', 'Acme');
    const result = mergeCustomers(
      [
        affected(current, { classification: 'CURRENT' }),
        affected(potential, { classification: 'POTENTIAL' }),
      ],
      [attribution(potential.id, customer), attribution(current.id, customer)],
      start.id,
    );
    expect(result.find((item) => item.entity.id === customer.id)?.classification).toBe('CURRENT');
  });

  it('is inferredOnly only when every attribution is inferredOnly', () => {
    const a = ref('Order', 'SO-1');
    const b = ref('Order', 'SO-2');
    const inferred = { stateUnknown: false, otherCause: false, inferredOnly: true };
    const sourced = { stateUnknown: false, otherCause: false, inferredOnly: false };
    const both = ref('Customer', 'Both');
    const mixed = ref('Customer', 'Mixed');
    const result = mergeCustomers(
      [affected(a, { flags: inferred }), affected(b, { flags: sourced })],
      [
        attribution(a.id, both),
        attribution(b.id, mixed),
        attribution(a.id, mixed),
      ],
      start.id,
    );
    const flagOf = (id: string) => result.find((item) => item.entity.id === id)?.flags.inferredOnly;
    expect(flagOf(both.id)).toBe(true);
    expect(flagOf(mixed.id)).toBe(false);
  });

  it('drops a customer equal to the start', () => {
    const order = ref('Order', 'SO-1');
    const customerStart = ref('Customer', 'Start customer', 'SUSPENDED');
    const result = mergeCustomers(
      [affected(order)],
      [attribution(order.id, customerStart)],
      customerStart.id,
    );
    expect(result.some((item) => item.entity.id === customerStart.id)).toBe(false);
  });

  it('merges a downstream-reached customer and keeps its distance and path', () => {
    const order = ref('Order', 'SO-1', 'BLOCKED');
    const customer = ref('Customer', 'Acme');
    const ownPath = directPath(customer);
    const reachedCustomer = affected(customer, {
      distance: 3,
      primaryPath: ownPath,
      classification: 'POTENTIAL',
    });
    const result = mergeCustomers(
      [affected(order, { classification: 'CURRENT' }), reachedCustomer],
      [attribution(order.id, customer)],
      start.id,
    );
    const merged = result.filter((item) => item.entity.id === customer.id);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.distance).toBe(3);
    expect(merged[0]?.directness).toBe('INDIRECT');
    expect(merged[0]?.primaryPath).toBe(ownPath);
    expect(merged[0]?.classification).toBe('CURRENT');
    expect(merged[0]?.attributions).toHaveLength(1);
  });

  it('ignores attributions of NOT_COUNTED entities', () => {
    const done = ref('Order', 'SO-1', 'COMPLETED');
    const customer = ref('Customer', 'Acme');
    const result = mergeCustomers(
      [affected(done, { classification: 'NOT_COUNTED', notCountedReason: 'TERMINAL' })],
      [attribution(done.id, customer)],
      start.id,
    );
    expect(result.some((item) => item.entity.id === customer.id)).toBe(false);
  });

  it('orders attributions CURRENT first, then type, displayName, id', () => {
    const customer = ref('Customer', 'Acme');
    const potentialOrder = ref('Order', 'A-order');
    const currentSla = ref('SLA', 'Z-sla', 'BLOCKED');
    const currentOrderB = ref('Order', 'B-order', 'BLOCKED');
    const currentOrderA = ref('Order', 'A-order', 'BLOCKED');
    const result = mergeCustomers(
      [
        affected(potentialOrder, { classification: 'POTENTIAL' }),
        affected(currentSla, { classification: 'CURRENT' }),
        affected(currentOrderB, { classification: 'CURRENT' }),
        affected(currentOrderA, { classification: 'CURRENT' }),
      ],
      [
        attribution(potentialOrder.id, customer),
        attribution(currentSla.id, customer),
        attribution(currentOrderB.id, customer),
        attribution(currentOrderA.id, customer),
      ],
      start.id,
    );
    const order = result
      .find((item) => item.entity.id === customer.id)
      ?.attributions.map((item) => item.attributedEntityId);
    // Order < SLA by type name; within Order, A-order < B-order; the potential order is last.
    expect(order).toEqual([currentOrderA.id, currentOrderB.id, currentSla.id, potentialOrder.id]);
  });

  it('leaves a terminal reached customer not counted and does not add it twice', () => {
    const order = ref('Order', 'SO-1');
    const closed = ref('Customer', 'Closed', 'CANCELLED');
    const result = mergeCustomers(
      [
        affected(order),
        affected(closed, { classification: 'NOT_COUNTED', notCountedReason: 'TERMINAL' }),
      ],
      [attribution(order.id, closed)],
      start.id,
    );
    const matches = result.filter((item) => item.entity.id === closed.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.classification).toBe('NOT_COUNTED');
    expect(matches[0]?.attributions).toEqual([]);
  });
});
