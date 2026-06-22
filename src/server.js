import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import { loadConfig, projectPaths } from './config.js';
import { Db } from './db.js';
import { Storage } from './storage.js';
import { BundleStore } from './bundle.js';
import { RateLimiter } from './ratelimit.js';
import { authRequired, pageAuthRequired, optionalAuth } from './auth/middleware.js';
import uploadRoutes from './routes/upload.js';
import rawRoutes from './routes/raw.js';
import viewRoutes from './routes/view.js';
import pageRoutes, { loginPageRoute } from './routes/pages.js';
import authRoutes from './routes/auth.js';
import tokenRoutes from './routes/tokens.js';

export async function buildServer(configOverrides = {}) {
  const config = loadConfig(configOverrides);

  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : true,
    bodyLimit: (config.maxFileSizeMb + 2) * 1024 * 1024,
  });

  const db = new Db(config.dbPath);
  const storage = new Storage(config.uploadsDir);
  const bundles = new BundleStore(config.sitesDir);
  const rateLimiter = new RateLimiter(db, { dailyLimit: config.dailyUploadLimit });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('storage', storage);
  app.decorate('bundles', bundles);
  app.decorate('rateLimiter', rateLimiter);

  app.addHook('onClose', async () => {
    db.close();
  });

  await app.register(fastifyCookie);

  await app.register(multipart, {
    limits: {
      fileSize: config.maxFileSizeMb * 1024 * 1024,
      files: 20,
      fields: 10,
    },
  });

  const mountPrefix = config.basePath || '/';
  const requireAuth = authRequired(config);
  const pageAuth = pageAuthRequired(config);
  const optAuth = optionalAuth(config);

  await app.register(
    async (scope) => {
      await scope.register(fastifyStatic, {
        root: projectPaths.publicDir,
        prefix: '/static/',
        decorateReply: false,
      });

      // Decorates reply.sendFile (with range + mime support) for serving
      // extracted bundle files. No routes are registered (serve: false).
      await scope.register(fastifyStatic, {
        root: config.sitesDir,
        serve: false,
        decorateReply: true,
      });

      scope.get('/api/health', async () => ({ status: 'ok' }));

      await scope.register(async (authScope) => {
        authScope.addHook('preHandler', optAuth);
        await authScope.register(authRoutes);
      });

      await scope.register(loginPageRoute);

      await scope.register(async (authScope) => {
        authScope.addHook('preHandler', requireAuth);
        await authScope.register(uploadRoutes);
        await authScope.register(tokenRoutes);
      });

      await scope.register(async (authScope) => {
        authScope.addHook('preHandler', pageAuth);
        await authScope.register(pageRoutes);
      });

      await scope.register(rawRoutes);
      await scope.register(viewRoutes);
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
