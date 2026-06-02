import { verifyToken } from './token.js';

export function authRequired(config) {
  return async function (request, reply) {
    const token = request.cookies?.token;
    if (!token) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    const payload = verifyToken(token, config.tokenSecret);
    if (!payload || !payload.email) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    const user = request.server.db.getUser(payload.email);
    if (!user) {
      return reply.status(401).send({ error: 'unauthorized' });
    }

    request.user = { email: user.email, verified: !!user.verified };
  };
}

export function optionalAuth(config) {
  return async function (request, _reply) {
    const token = request.cookies?.token;
    if (!token) return;

    const payload = verifyToken(token, config.tokenSecret);
    if (!payload || !payload.email) return;

    const user = request.server.db.getUser(payload.email);
    if (user) {
      request.user = { email: user.email, verified: !!user.verified };
    }
  };
}
