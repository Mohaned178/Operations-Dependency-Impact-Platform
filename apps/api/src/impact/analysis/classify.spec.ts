import { directPath, hop, path, reached, ref } from '../../../test/impact-builders';
import { classifyReached } from './classify';

describe('classifyReached', () => {
  it('makes a terminal entity NOT_COUNTED with reason TERMINAL and its canonical path', () => {
    const done = ref('Order', 'Done', 'COMPLETED');
    const canonical = directPath(done);
    const [item] = classifyReached({
      reached: [reached(done, { canonical, live: directPath(done), sourced: false })],
    });
    expect(item?.classification).toBe('NOT_COUNTED');
    expect(item?.notCountedReason).toBe('TERMINAL');
    expect(item?.primaryPath).toBe(canonical);
    expect(item?.flags).toEqual({ stateUnknown: false, otherCause: false, inferredOnly: false });
  });

  it('takes the primary path from livePath for a current entity', () => {
    const order = ref('Order', 'Blocked', 'BLOCKED');
    const live = directPath(order);
    const [item] = classifyReached({
      reached: [reached(order, { canonical: directPath(order), live })],
    });
    expect(item?.classification).toBe('CURRENT');
    expect(item?.primaryPath).toBe(live);
    expect(item?.flags.otherCause).toBe(false);
  });

  it('takes the canonical path for a potential entity', () => {
    const order = ref('Order', 'Active', 'ACTIVE');
    const canonical = directPath(order);
    const [item] = classifyReached({ reached: [reached(order, { canonical, live: null })] });
    expect(item?.classification).toBe('POTENTIAL');
    expect(item?.primaryPath).toBe(canonical);
  });

  it('derives DIRECT and INDIRECT from the distance', () => {
    const near = ref('Order', 'Near');
    const far = ref('Order', 'Far');
    const items = classifyReached({
      reached: [reached(near, { distance: 1 }), reached(far, { distance: 2 })],
    });
    expect(items.map((item) => item.directness)).toEqual(['DIRECT', 'INDIRECT']);
    expect(items.map((item) => item.distance)).toEqual([1, 2]);
  });

  it('drops the shortest path when it equals the primary path by hop keys', () => {
    const order = ref('Order', 'Same');
    const first = hop(order, { key: 'k1' });
    const [same] = classifyReached({
      reached: [reached(order, { canonical: path([first]), shortest: path([hop(order, { key: 'k1' })]) })],
    });
    expect(same?.shortestPath).toBeNull();

    const other = ref('Order', 'Other');
    const shortest = path([hop(other, { key: 'k2' })]);
    const [different] = classifyReached({
      reached: [reached(other, { canonical: path([hop(other, { key: 'k1' })]), shortest })],
    });
    expect(different?.shortestPath).toBe(shortest);
  });

  it('flags an UNKNOWN entity as stateUnknown and counts it as potential', () => {
    const unknown = ref('Shipment', 'Unknown', 'UNKNOWN');
    const [item] = classifyReached({ reached: [reached(unknown)] });
    expect(item?.classification).toBe('POTENTIAL');
    expect(item?.flags.stateUnknown).toBe(true);
    expect(item?.flags.otherCause).toBe(false);
  });

  it('flags an impaired potential entity as otherCause', () => {
    const delayed = ref('Shipment', 'Delayed', 'DELAYED');
    const [item] = classifyReached({ reached: [reached(delayed, { live: null })] });
    expect(item?.classification).toBe('POTENTIAL');
    expect(item?.flags.otherCause).toBe(true);
  });

  it('flags inferredOnly only for counted entities', () => {
    const counted = ref('Order', 'Counted');
    const terminal = ref('Order', 'Terminal', 'CANCELLED');
    const items = classifyReached({
      reached: [reached(counted, { sourced: false }), reached(terminal, { sourced: false })],
    });
    expect(items.map((item) => item.flags.inferredOnly)).toEqual([true, false]);
  });

  it('keeps the trace order and starts every entity without attributions', () => {
    const a = ref('Order', 'A');
    const b = ref('Product', 'B');
    const items = classifyReached({ reached: [reached(a), reached(b)] });
    expect(items.map((item) => item.entity.id)).toEqual([a.id, b.id]);
    expect(items.every((item) => item.attributions.length === 0)).toBe(true);
  });
});
