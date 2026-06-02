import fs from 'node:fs';
import path from 'node:path';
import { projectPaths } from '../config.js';
import { renderTemplate } from '../template.js';

const UPLOAD_PAGE = path.join(projectPaths.publicDir, 'pageupload.html');
const LOGIN_PAGE = path.join(projectPaths.publicDir, 'login.html');

function readMaybeText(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

export default async function pageRoutes(app) {
  const uploadTpl = readMaybeText(UPLOAD_PAGE);
  const renderedUpload = uploadTpl == null ? null : renderTemplate(uploadTpl, app.config);

  app.get('/', async (_request, reply) => {
    if (!renderedUpload) {
      return reply.code(500).send({ error: 'page_missing' });
    }
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(renderedUpload);
  });

  app.get('/pageupload', async (_request, reply) => {
    if (!renderedUpload) {
      return reply.code(500).send({ error: 'page_missing' });
    }
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(renderedUpload);
  });
}

export async function loginPageRoute(app) {
  const loginTpl = readMaybeText(LOGIN_PAGE);
  const renderedLogin = loginTpl == null ? null : renderTemplate(loginTpl, app.config);

  app.get('/login', async (_request, reply) => {
    if (!renderedLogin) {
      return reply.code(500).send({ error: 'page_missing' });
    }
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(renderedLogin);
  });
}
