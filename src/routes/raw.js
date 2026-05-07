import { isValidHash } from '../hash.js';

export default async function rawRoutes(app) {
  const { storage, db } = app;

  app.get('/raw/:hash', async (request, reply) => {
    const { hash } = request.params;
    if (!isValidHash(hash)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const row = db.getUpload(hash);
    if (!row) {
      return reply.code(404).send({ error: 'not_found' });
    }
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
  });
}
