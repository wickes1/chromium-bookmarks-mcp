/**
 * Chrome Native Messaging binary protocol.
 * Format: 4-byte little-endian uint32 length + UTF-8 JSON body.
 * Max message size: 1MB (host → extension).
 */

const MAX_MESSAGE_SIZE = 1024 * 1024; // 1 MB

export function encodeNativeMessage(msg: unknown): Buffer {
  const json = JSON.stringify(msg);
  const body = Buffer.from(json, 'utf-8');
  if (body.length > MAX_MESSAGE_SIZE) {
    throw new Error(`Message too large: ${body.length} bytes (max ${MAX_MESSAGE_SIZE})`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

export interface DecodeResult {
  messages: unknown[];
  remaining: Buffer;
}

export function decodeNativeMessages(buffer: Buffer): DecodeResult {
  const messages: unknown[] = [];
  let offset = 0;

  while (offset + 4 <= buffer.length) {
    const msgLen = buffer.readUInt32LE(offset);
    if (msgLen > MAX_MESSAGE_SIZE) {
      throw new Error(`Message too large: ${msgLen} bytes`);
    }
    const totalLen = 4 + msgLen;
    if (offset + totalLen > buffer.length) break;

    const jsonBuf = buffer.subarray(offset + 4, offset + totalLen);
    messages.push(JSON.parse(jsonBuf.toString('utf-8')));
    offset += totalLen;
  }

  return { messages, remaining: buffer.subarray(offset) };
}
