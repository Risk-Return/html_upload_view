import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from '../config.js';

const UPLOAD_PAGE = path.join(projectPaths.publicDir, 'pageupload.html');

function readMaybe(p) {
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

export default async function pageRoutes(app) {
  const uploadHtml = readMaybe(UPLOAD_PAGE);

  app.get('/pageupload', async (_request, reply) => {
    if (!uploadHtml) {
      return reply.code(500).send({ error: 'page_missing' });
    }
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(uploadHtml);
  });
}
