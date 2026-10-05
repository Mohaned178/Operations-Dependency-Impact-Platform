export function decodeUtf8(buffer: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
