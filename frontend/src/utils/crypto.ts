const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const fromHex = (hex: string) => {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const pairs = hex.match(/.{1,2}/g) ?? [];
  return new Uint8Array(pairs.map((byte) => parseInt(byte, 16)));
};

const deriveKey = async (secret: string) => {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

export const encryptBody = async (secret: string, body: string) => {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(body));
  return `${toHex(iv)}:${toHex(encrypted)}`;
};

export const decryptBody = async (secret: string, payload: string) => {
  if (!payload) return '';
  const [ivHex, dataHex] = payload.split(':');
  if (!ivHex || !dataHex) {
    throw new Error('Encrypted body is malformed');
  }
  const key = await deriveKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromHex(ivHex) },
    key,
    fromHex(dataHex)
  );
  return decoder.decode(decrypted);
};
