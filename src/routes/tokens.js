import { isValidHash } from '../hash.js';

function parseTokenList(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    for (const item of parsed) {
      if (typeof item.token !== 'string' || item.token.length === 0) return null;
      if (item.maxUses !== undefined && (!Number.isInteger(item.maxUses))) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function sanitizeTokens(list) {
  return list.map((t) => ({
    token: String(t.token).trim(),
    maxUses: t.maxUses === undefined ? -1 : t.maxUses,
  })).filter((t) => t.token.length > 0);
}

export default async function tokenRoutes(app) {
  const { db } = app;

  app.get('/api/uploads/:hash/tokens', async (request, reply) => {
    const { hash } = request.params;
    if (!isValidHash(hash)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const row = db.getUpload(hash);
    if (!row) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (!request.user || row.uploadedBy !== request.user.email) {
      return reply.code(403).send({ error: 'forbidden' });
    }
    const tokens = db.getAccessTokens(hash);
    return reply.send({ tokens });
  });

  app.put('/api/uploads/:hash/tokens', async (request, reply) => {
    const { hash } = request.params;
    if (!isValidHash(hash)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const row = db.getUpload(hash);
    if (!row) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (!request.user || row.uploadedBy !== request.user.email) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const body = request.body || {};
    const list = sanitizeTokens(body.tokens || []);
    if (list.length === 0) {
      db.replaceAccessTokens(hash, []);
      return reply.send({ tokens: [] });
    }

    const result = db.replaceAccessTokens(hash, list);
    return reply.send({ tokens: result });
  });

  app.post('/api/uploads/:hash/tokens', async (request, reply) => {
    const { hash } = request.params;
    if (!isValidHash(hash)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const row = db.getUpload(hash);
    if (!row) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (!request.user || row.uploadedBy !== request.user.email) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const body = request.body || {};
    if (!body.token || typeof body.token !== 'string' || body.token.trim().length === 0) {
      return reply.code(400).send({ error: 'token_required' });
    }
    const maxUses = body.maxUses === undefined ? -1 : body.maxUses;
    if (!Number.isInteger(maxUses)) {
      return reply.code(400).send({ error: 'invalid_max_uses' });
    }

    const created = db.addAccessToken(hash, body.token.trim(), maxUses);
    if (!created) {
      return reply.code(409).send({ error: 'token_exists' });
    }
    return reply.code(201).send({ token: created });
  });

  app.delete('/api/uploads/:hash/tokens/:id', async (request, reply) => {
    const { hash } = request.params;
    const id = Number(request.params.id);
    if (!isValidHash(hash)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const row = db.getUpload(hash);
    if (!row) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (!request.user || row.uploadedBy !== request.user.email) {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const token = db.getAccessToken(id);
    if (!token || token.uploadHash !== hash) {
      return reply.code(404).send({ error: 'not_found' });
    }
    db.deleteAccessToken(id);
    return reply.send({ ok: true });
  });
}

export { parseTokenList, sanitizeTokens };
