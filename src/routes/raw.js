import { isValidHash } from '../hash.js';

export default async function rawRoutes(app) {
  const { storage, db, bundles, config } = app;
  const prefix = config.basePath || '';

  function checkAccess(hash, request, reply) {
    if (!db.hasAccessTokens(hash)) return true;
    const token = request.query?.token || request.headers['x-access-token'];
    if (!token) {
      reply.code(401).header('Content-Type', 'application/json; charset=utf-8');
      reply.send({ error: 'token_required' });
      return false;
    }
    const result = db.validateAccessToken(hash, token);
    if (!result.valid) {
      reply.code(403).header('Content-Type', 'application/json; charset=utf-8');
      reply.send({ error: result.exhausted ? 'token_exhausted' : 'invalid_token' });
      return false;
    }
    return true;
  }

  async function serveHtmlFile(hash, reply) {
    let body;
    try {
      body = await storage.readHtml(hash);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return reply.code(404).send({ error: 'not_found' });
      }
      throw err;
    }
    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public, max-age=60')
      .header('Content-Security-Policy', "frame-ancestors 'self'");
    return reply.send(body);
  }

  function serveBundleEntry(hash, reply) {
    const entry = bundles.resolveEntry(hash);
    if (!entry) {
      return reply.code(404).send({ error: 'not_found' });
    }
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public, max-age=60')
      .header('Content-Security-Policy', "frame-ancestors 'self'");
    return reply.sendFile(entry, bundles.dirFor(hash));
  }

  // Public endpoint: check if an upload requires an access token
  app.get('/api/uploads/:hash/token-check', async (request, reply) => {
    const { hash } = request.params;
    if (!isValidHash(hash)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const row = db.getUpload(hash);
    if (!row) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const requiresToken = db.hasAccessTokens(hash);
    return reply.send({ requiresToken });
  });

  // Direct hit without trailing slash. Single HTML files are served inline;
  // bundles redirect to the trailing-slash form so relative asset URLs in the
  // document resolve under /raw/<hash>/.
  app.get('/raw/:hash', async (request, reply) => {
    const { hash } = request.params;
    if (!isValidHash(hash)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const row = db.getUpload(hash);
    if (!row) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (!checkAccess(hash, request, reply)) return;
    if (row.kind === 'bundle') {
      const qs = request.query?.token ? `?token=${encodeURIComponent(request.query.token)}` : '';
      return reply.redirect(`${prefix}/raw/${hash}/${qs}`);
    }
    return serveHtmlFile(hash, reply);
  });

  // Bundle entry (empty rest) and bundle assets (relative path).
  app.get('/raw/:hash/*', async (request, reply) => {
    const { hash } = request.params;
    const rest = request.params['*'] || '';
    if (!isValidHash(hash)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const row = db.getUpload(hash);
    if (!row) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (!checkAccess(hash, request, reply)) return;

    if (row.kind !== 'bundle') {
      if (rest === '' || rest === '/') {
        return serveHtmlFile(hash, reply);
      }
      return reply.code(404).send({ error: 'not_found' });
    }

    if (rest === '' || rest === '/') {
      return serveBundleEntry(hash, reply);
    }

    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'public, max-age=300');
    return reply.sendFile(rest, bundles.dirFor(hash));
  });
}
