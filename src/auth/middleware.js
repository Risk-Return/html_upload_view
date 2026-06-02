import { verifyToken } from './token.js';

function checkAuth(request, tokenSecret) {
  const token = request.cookies?.token;
  if (!token) return null;

  const payload = verifyToken(token, tokenSecret);
  if (!payload || !payload.email) return null;

  const user = request.server.db.getUser(payload.email);
  if (!user) return null;

  return { email: user.email, verified: !!user.verified };
}

export function authRequired(config) {
  return async function (request, reply) {
    const user = checkAuth(request, config.tokenSecret);
    if (!user) {
      return reply.status(401).send({ error: 'unauthorized' });
    }
    request.user = user;
  };
}

export function pageAuthRequired(config) {
  const basePath = config.basePath || '';

  return async function (request, reply) {
    const user = checkAuth(request, config.tokenSecret);
    if (!user) {
      const redirect = `${basePath}/login?redirect=${encodeURIComponent(request.raw.url)}`;
      return reply.redirect(redirect);
    }
    request.user = user;
  };
}

export function optionalAuth(config) {
  return async function (request, _reply) {
    const user = checkAuth(request, config.tokenSecret);
    if (user) {
      request.user = user;
    }
  };
}
