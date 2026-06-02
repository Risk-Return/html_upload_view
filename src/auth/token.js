import crypto from 'node:crypto';

function base64url(buf) {
  return buf.toString('base64url');
}

function base64urlDecode(s) {
  return Buffer.from(s, 'base64url');
}

export function signToken(payload, secret, expiresInSeconds) {
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(Buffer.from(JSON.stringify({
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  })));
  const signature = base64url(
    crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, bodyB64, sigB64] = parts;
  const expectedSig = base64url(
    crypto.createHmac('sha256', secret).update(`${headerB64}.${bodyB64}`).digest(),
  );

  if (!crypto.timingSafeEqual(Buffer.from(sigB64, 'base64url'), Buffer.from(expectedSig, 'base64url'))) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(bodyB64).toString('utf-8'));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) return null;

  return payload;
}
