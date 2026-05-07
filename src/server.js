import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { loadConfig, projectPaths } from './config.js';
import { Db } from './db.js';
import { Storage } from './storage.js';
import { RateLimiter } from './ratelimit.js';
import uploadRoutes from './routes/upload.js';
import rawRoutes from './routes/raw.js';
import viewRoutes from './routes/view.js';
import pageRoutes from './routes/pages.js';

export async function buildServer(configOverrides = {}) {
  const config = loadConfig(configOverrides);

  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : true,
    bodyLimit: (config.maxFileSizeMb + 2) * 1024 * 1024,
  });

  const db = new Db(config.dbPath);
  const storage = new Storage(config.uploadsDir);
  const rateLimiter = new RateLimiter(db, { dailyLimit: config.dailyUploadLimit });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('storage', storage);
  app.decorate('rateLimiter', rateLimiter);

  app.addHook('onClose', async () => {
    db.close();
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.maxFileSizeMb * 1024 * 1024,
      files: 20,
      fields: 10,
    },
  });

  const mountPrefix = config.basePath || '/';

  await app.register(
    async (scope) => {
      await scope.register(fastifyStatic, {
        root: projectPaths.publicDir,
        prefix: '/static/',
        decorateReply: false,
      });

      scope.get('/api/health', async () => ({ status: 'ok' }));

      await scope.register(uploadRoutes);
      await scope.register(rawRoutes);
      await scope.register(viewRoutes);
      await scope.register(pageRoutes);
    },
    { prefix: mountPrefix },
  );

  return app;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const app = await buildServer();
  try {
    await app.listen({ port: app.config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
