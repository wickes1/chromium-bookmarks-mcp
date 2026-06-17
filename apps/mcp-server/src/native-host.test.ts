import { describe, test, expect } from 'bun:test';
import {
  handleCallTool,
  resolvePort,
  dispatchToolCall,
  type CallToolDeps,
  type PendingRequest,
} from './native-host.js';
import { DEFAULT_PORT, EXTENSION_OP_TIMEOUT_MS } from './types.js';
import type { ToolCallResponse } from './types.js';

const TOKEN = 'test-token-abc';

function depsWith(overrides: Partial<CallToolDeps> = {}): CallToolDeps {
  return {
    authToken: TOKEN,
    pendingCount: () => 0,
    maxPending: 100,
    callTool: async () => ({ status: 'success', data: { ok: true } }),
    ...overrides,
  };
}

const goodBody = () => Promise.resolve({ toolName: 'ping', args: {} });

describe('handleCallTool — auth (SEC-1)', () => {
  test('rejects an absent token with 401 UNAUTHORIZED', async () => {
    const { body, status } = await handleCallTool(null, goodBody, depsWith());
    expect(status).toBe(401);
    expect(body).toEqual({ status: 'error', error: 'unauthorized', code: 'UNAUTHORIZED' });
  });

  test('rejects a mismatched token with 401 UNAUTHORIZED', async () => {
    const { body, status } = await handleCallTool('wrong', goodBody, depsWith());
    expect(status).toBe(401);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  test('rejects everything when the host has no token configured', async () => {
    const { status } = await handleCallTool('', goodBody, depsWith({ authToken: '' }));
    expect(status).toBe(401);
  });

  test('accepts a matching token and returns the tool result', async () => {
    const { body, status } = await handleCallTool(TOKEN, goodBody, depsWith());
    expect(status).toBe(200);
    expect(body).toEqual({ status: 'success', data: { ok: true } });
  });
});

describe('handleCallTool — backpressure (CORR-6)', () => {
  test('returns 503 BACKPRESSURE at maxPending', async () => {
    const { body, status } = await handleCallTool(
      TOKEN,
      goodBody,
      depsWith({ pendingCount: () => 100, maxPending: 100 }),
    );
    expect(status).toBe(503);
    expect(body).toEqual({ status: 'error', error: 'Too many pending requests', code: 'BACKPRESSURE' });
  });

  test('does not invoke the tool when backpressured', async () => {
    let called = false;
    await handleCallTool(
      TOKEN,
      goodBody,
      depsWith({
        pendingCount: () => 100,
        maxPending: 100,
        callTool: async () => {
          called = true;
          return { status: 'success' };
        },
      }),
    );
    expect(called).toBe(false);
  });

  test('passes through just below the limit', async () => {
    const { status } = await handleCallTool(
      TOKEN,
      goodBody,
      depsWith({ pendingCount: () => 99, maxPending: 100 }),
    );
    expect(status).toBe(200);
  });
});

describe('handleCallTool — body validation (CORR-6)', () => {
  test('returns 400 BAD_REQUEST when toolName is missing', async () => {
    const { body, status } = await handleCallTool(
      TOKEN,
      () => Promise.resolve({ args: {} }),
      depsWith(),
    );
    expect(status).toBe(400);
    expect(body).toEqual({ status: 'error', error: 'toolName (string) is required', code: 'BAD_REQUEST' });
  });

  test('returns 400 BAD_REQUEST when toolName is not a string', async () => {
    const { body, status } = await handleCallTool(
      TOKEN,
      () => Promise.resolve({ toolName: 123 }),
      depsWith(),
    );
    expect(status).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
  });

  test('returns 400 BAD_REQUEST on invalid JSON body', async () => {
    const { body, status } = await handleCallTool(
      TOKEN,
      () => Promise.reject(new SyntaxError('Unexpected token')),
      depsWith(),
    );
    expect(status).toBe(400);
    expect(body).toEqual({ status: 'error', error: 'Invalid JSON body', code: 'BAD_REQUEST' });
  });

  test('defaults args to {} when omitted', async () => {
    let received: Record<string, unknown> | undefined;
    const { status } = await handleCallTool(
      TOKEN,
      () => Promise.resolve({ toolName: 'ping' }),
      depsWith({
        callTool: async (_name, args) => {
          received = args;
          return { status: 'success' };
        },
      }),
    );
    expect(status).toBe(200);
    expect(received).toEqual({});
  });
});

describe('handleCallTool — tool errors (CORR-6)', () => {
  test('wraps a thrown tool error as 500 TOOL_ERROR', async () => {
    const { body, status } = await handleCallTool(
      TOKEN,
      goodBody,
      depsWith({ callTool: async () => { throw new Error('boom'); } }),
    );
    expect(status).toBe(500);
    expect(body).toEqual({ status: 'error', error: 'boom', code: 'TOOL_ERROR' });
  });
});

describe('resolvePort (SEC-4)', () => {
  test('honors a valid in-range integer port', () => {
    expect(resolvePort(31000)).toBe(31000);
  });

  test('falls back to DEFAULT_PORT when port is undefined', () => {
    expect(resolvePort(undefined)).toBe(DEFAULT_PORT);
  });

  test('rejects a non-integer port', () => {
    expect(resolvePort(1234.5)).toBe(DEFAULT_PORT);
  });

  test('rejects an out-of-range port (too high)', () => {
    expect(resolvePort(70000)).toBe(DEFAULT_PORT);
  });

  test('rejects an out-of-range port (too low / zero)', () => {
    expect(resolvePort(0)).toBe(DEFAULT_PORT);
  });

  test('rejects a negative port', () => {
    expect(resolvePort(-1)).toBe(DEFAULT_PORT);
  });
});

describe('dispatchToolCall lifecycle (TEST-2)', () => {
  test('registers a pending entry then resolves and the caller can clear it', async () => {
    const map = new Map<string, PendingRequest>();
    const promise = dispatchToolCall(map, 'req-1', () => {}, 1_000);

    // Entry is registered while in flight.
    expect(map.has('req-1')).toBe(true);

    // Simulate the extension responding (mirrors handleExtensionMessage).
    const pending = map.get('req-1')!;
    clearTimeout(pending.timer);
    map.delete('req-1');
    const response: ToolCallResponse = { status: 'success', data: 42 };
    pending.resolve(response);

    await expect(promise).resolves.toEqual(response);
    expect(map.has('req-1')).toBe(false);
  });

  test('a timed-out request deletes its pendingRequests entry and rejects', async () => {
    const map = new Map<string, PendingRequest>();
    // Use a tiny timeout so the real timer fires quickly.
    const promise = dispatchToolCall(map, 'req-timeout', () => {}, 5);
    expect(map.has('req-timeout')).toBe(true);

    await expect(promise).rejects.toThrow(/Request timed out after 5ms/);
    // The entry must not leak after the timeout fires.
    expect(map.has('req-timeout')).toBe(false);
  });

  test('defaults to EXTENSION_OP_TIMEOUT_MS (the innermost budget, ARCH-5)', () => {
    const map = new Map<string, PendingRequest>();
    let sent = false;
    const promise = dispatchToolCall(map, 'req-budget', () => { sent = true; });
    // The send callback fires synchronously; clean up the long-lived timer.
    expect(sent).toBe(true);
    const pending = map.get('req-budget')!;
    clearTimeout(pending.timer);
    map.delete('req-budget');
    pending.resolve({ status: 'success' });
    return promise.then(() => {
      // Sanity: the default constant is the contract's inner budget.
      expect(EXTENSION_OP_TIMEOUT_MS).toBe(25_000);
    });
  });
});
