// Password hashing (scrypt) and stateless signed session tokens (HMAC).
import crypto from 'crypto';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [, saltHex, hashHex] = String(stored).split('$');
    const salt = Buffer.from(saltHex, 'hex');
    const dk = crypto.scryptSync(String(password), salt, 32);
    return crypto.timingSafeEqual(dk, Buffer.from(hashHex, 'hex'));
  } catch {
    return false;
  }
}

// ---- session tokens: base64url(json).base64url(hmac) ----
export function makeToken(payload, secret, ttlHours = 24 * 14) {
  const body = { ...payload, exp: Date.now() + ttlHours * 3600 * 1000 };
  const json = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(json).digest('base64url');
  return `${json}.${sig}`;
}

export function readToken(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [json, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', secret).update(json).digest('base64url');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const body = JSON.parse(Buffer.from(json, 'base64url').toString());
    if (!body.exp || body.exp < Date.now()) return null;
    return body;
  } catch {
    return null;
  }
}

export const randomId = (n = 9) => crypto.randomBytes(n).toString('base64url');
