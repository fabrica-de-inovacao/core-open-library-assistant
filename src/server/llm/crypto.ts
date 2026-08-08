import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function key() {
  const raw = process.env.USER_SECRET_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!raw) throw new Error('USER_SECRET_ENCRYPTION_KEY ou AUTH_SECRET obrigatório para secrets.');
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function decryptSecret(payload: string) {
  const [ivRaw, tagRaw, encryptedRaw] = payload.split('.');
  const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
