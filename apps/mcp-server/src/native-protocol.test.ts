import { describe, test, expect } from 'bun:test';
import { encodeNativeMessage, decodeNativeMessages } from './native-protocol.js';

describe('native-protocol', () => {
  test('encodeNativeMessage produces 4-byte LE header + JSON', () => {
    const msg = { type: 'ping', requestId: '123' };
    const encoded = encodeNativeMessage(msg);
    const jsonStr = JSON.stringify(msg);
    const expectedLen = Buffer.byteLength(jsonStr, 'utf-8');

    expect(encoded.readUInt32LE(0)).toBe(expectedLen);
    expect(encoded.subarray(4).toString('utf-8')).toBe(jsonStr);
  });

  test('decodeNativeMessages parses one complete message', () => {
    const msg = { type: 'pong', requestId: '456' };
    const encoded = encodeNativeMessage(msg);
    const { messages, remaining } = decodeNativeMessages(encoded);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(msg);
    expect(remaining.length).toBe(0);
  });

  test('decodeNativeMessages handles partial data', () => {
    const msg = { type: 'ping', requestId: '789' };
    const encoded = encodeNativeMessage(msg);
    const partial = encoded.subarray(0, 6);
    const { messages, remaining } = decodeNativeMessages(partial);

    expect(messages).toHaveLength(0);
    expect(remaining.length).toBe(6);
  });

  test('decodeNativeMessages handles two concatenated messages', () => {
    const msg1 = { type: 'ping', requestId: '1' };
    const msg2 = { type: 'pong', requestId: '2' };
    const combined = Buffer.concat([encodeNativeMessage(msg1), encodeNativeMessage(msg2)]);
    const { messages, remaining } = decodeNativeMessages(combined);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(msg1);
    expect(messages[1]).toEqual(msg2);
    expect(remaining.length).toBe(0);
  });
});
