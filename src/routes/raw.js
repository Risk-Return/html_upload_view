import { isValidHash } from '../hash.js';

export default async function rawRoutes(app) {
  const { storage, db, bundles, config } = app;
  const prefix = config.basePath || '';

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
    if (row.kind === 'bundle') {
      return reply.redirect(`${prefix}/raw/${hash}/`);
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
