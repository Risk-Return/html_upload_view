import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from '../config.js';
import { renderTemplate } from '../template.js';

const UPLOAD_PAGE = path.join(projectPaths.publicDir, 'pageupload.html');

function readMaybeText(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

export default async function pageRoutes(app) {
  const uploadTpl = readMaybeText(UPLOAD_PAGE);
  const rendered = uploadTpl == null ? null : renderTemplate(uploadTpl, app.config);

  const handler = async (_request, reply) => {
    if (!rendered) {
      return reply.code(500).send({ error: 'page_missing' });
    }
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(rendered);
  };

  app.get('/', handler);
  app.get('/pageupload', handler);
}
