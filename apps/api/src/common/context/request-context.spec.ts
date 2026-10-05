import type { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { RequestContext } from './request-context';

class FakeClsService {
  private store = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  run<T>(callback: () => T): T {
    const previous = this.store;
    this.store = new Map();
    try {
      return callback();
    } finally {
      this.store = previous;
    }
  }
}

function createContext(): { context: RequestContext; cls: FakeClsService } {
  const cls = new FakeClsService();
  const context = new RequestContext(cls as unknown as ClsService);
  return { context, cls };
}

describe('RequestContext.runDetached', () => {
  it('sets a fresh UUID correlation id and no user id', async () => {
    const { context } = createContext();
    context.setUserId('0f2b4c6d-8e1a-4b3c-9d5e-7f8a1b2c3d4e');

    await context.runDetached(() => {
      expect(z.string().uuid().safeParse(context.correlationId).success).toBe(true);
      expect(context.userId).toBeUndefined();
      return Promise.resolve();
    });
  });

  it('gives every detached run a different correlation id', async () => {
    const { context } = createContext();
    const first = await context.runDetached(() => Promise.resolve(context.correlationId));
    const second = await context.runDetached(() => Promise.resolve(context.correlationId));
    expect(first).not.toBe(second);
  });
});
