const lifetime = 90 * 24 * 60 * 60 * 1000;
const encode = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function key(env) {
  const secret = String(env.CONTACT_SHEETS_ADMIN_KEY || '');
  if (!secret) throw Error('Staff access is not configured.');
  return crypto.subtle.importKey('raw', new TextEncoder().encode('roll-call-office:v1:' + secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
}
export async function createRollCallSession(env, now = Date.now()) {
  const body = encode(new TextEncoder().encode(JSON.stringify({aud:'roll-call-office',iat:now,exp:now+lifetime,nonce:crypto.randomUUID()})));
  const signature = await crypto.subtle.sign('HMAC', await key(env), new TextEncoder().encode(body));
  return body + '.' + encode(new Uint8Array(signature));
}
export async function requireRollCallStaff(env, data, passwordAuth) {
  if (data.adminKey) return passwordAuth(env, data);
  try {
    const token = String(data.rollCallSession || '');
    if (token.length > 1000) throw Error();
    const parts = token.split('.');
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw Error();
    const decode = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
    if (!await crypto.subtle.verify('HMAC', await key(env), decode(parts[1]), new TextEncoder().encode(parts[0]))) throw Error();
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const now = Date.now();
    if (payload.aud !== 'roll-call-office' || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.iat > now || payload.exp <= now || payload.exp-payload.iat !== lifetime) throw Error();
  } catch {
    const error = Error('Please sign in to Roll Call Office again.');
    error.status = 401;
    throw error;
  }
}
