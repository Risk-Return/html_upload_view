import fs from 'node:fs';
import path from 'node:path';
import { isValidHash } from '../hash.js';
import { projectPaths } from '../config.js';

const VIEW_PAGE = path.join(projectPaths.publicDir, 'view.html');

function readMaybe(p) {
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

export default async function viewRoutes(app) {
  const viewHtml = readMaybe(VIEW_PAGE);

  app.get('/view/:hash', async (request, reply) => {
    const { hash } = request.params;
    if (!isValidHash(hash)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const row = app.db.getUpload(hash);
    if (!row) {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (!viewHtml) {
      return reply.code(500).send({ error: 'page_missing' });
    }
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(viewHtml);
  });
}
