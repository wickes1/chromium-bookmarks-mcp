/**
 * Chrome Native Messaging binary protocol.
 * Format: 4-byte little-endian uint32 length + UTF-8 JSON body.
 *
 * Size limits (per Chrome docs):
 *   Host → Extension: 1 MB max
 *   Extension → Host: no hard limit (uint32 header supports up to 4 GB)
 *
 * We enforce 1 MB on encode (host → extension) but allow up to 64 MB
 * on decode (extension → host) to handle large bookmark trees.
 */

const MAX_ENCODE_SIZE = 1024 * 1024;       // 1 MB (host → extension)
const MAX_DECODE_SIZE = 64 * 1024 * 1024;  // 64 MB (extension → host)

export function encodeNativeMessage(msg: unknown): Buffer {
  const json = JSON.stringify(msg);
  const body = Buffer.from(json, 'utf-8');
  if (body.length > MAX_ENCODE_SIZE) {
    throw new Error(`Message too large: ${body.length} bytes (max ${MAX_ENCODE_SIZE})`);
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
    if (msgLen > MAX_DECODE_SIZE) {
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
