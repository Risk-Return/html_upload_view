import { generateHash } from '../hash.js';
import { clientIp } from '../ip.js';

const HTML_EXT = /\.html?$/i;
const ALLOWED_MIME = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'application/octet-stream',
]);

function buildPreviewUrl(publicHost, basePath, hash) {
  const host = publicHost.replace(/\/+$/, '');
  const prefix = basePath || '';
  return `${host}${prefix}/view/${hash}`;
}

export default async function uploadRoutes(app) {
  const { config, db, storage, rateLimiter } = app;
  const maxBytes = config.maxFileSizeMb * 1024 * 1024;

  app.get('/api/uploads', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const rows = db.getUploadsByUser(request.user.email);
    return reply.send(rows.map((r) => ({
      hash: r.hash,
      originalName: r.originalName,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt,
      url: buildPreviewUrl(config.publicHost, config.basePath, r.hash),
    })));
  });

  app.post('/api/upload', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(400).send({ error: 'multipart_required' });
    }

    const ip = clientIp(request);
    const uploadedBy = request.user?.email ?? null;
    const collected = [];
    let oversize = false;
    let invalidType = false;

    try {
      for await (const part of request.parts()) {
        if (part.type !== 'file') continue;
        const filename = part.filename || '';
        const mime = (part.mimetype || '').toLowerCase();

        if (!HTML_EXT.test(filename) || !ALLOWED_MIME.has(mime)) {
          invalidType = true;
          await part.toBuffer().catch(() => {});
          continue;
        }

        let buf;
        try {
          buf = await part.toBuffer();
        } catch (err) {
          if (err.code === 'FST_REQ_FILE_TOO_LARGE' || part.file?.truncated) {
            oversize = true;
            continue;
          }
          throw err;
        }

        if (part.file?.truncated || buf.length > maxBytes) {
          oversize = true;
          continue;
        }

        const head = buf.slice(0, 512).toString('utf-8').trimStart().toLowerCase();
        if (head.length > 0 && head[0] !== '<') {
          invalidType = true;
          continue;
        }

        collected.push({ filename, buffer: buf });
      }
    } catch (err) {
      if (err && err.code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({
          error: 'file_too_large',
          maxFileSizeMb: config.maxFileSizeMb,
        });
      }
      request.log.error({ err }, 'multipart parse failure');
      return reply.code(400).send({ error: 'invalid_multipart' });
    }

    if (oversize) {
      return reply.code(413).send({
        error: 'file_too_large',
        maxFileSizeMb: config.maxFileSizeMb,
      });
    }
    if (invalidType) {
      return reply.code(415).send({ error: 'invalid_file_type' });
    }
    if (collected.length === 0) {
      return reply.code(400).send({ error: 'no_files' });
    }

    const consume = rateLimiter.tryConsume(ip, collected.length);
    if (!consume.ok) {
      return reply.code(429).send({
        error: 'quota_exceeded',
        limit: consume.limit,
        remaining: consume.remaining,
        requested: consume.requested,
      });
    }

    const now = Date.now();
    const results = [];
    for (const { filename, buffer } of collected) {
      let hash = generateHash();
      let inserted = db.insertUpload({
        hash,
        originalName: filename,
        sizeBytes: buffer.length,
        ip,
        createdAt: now,
        uploadedBy,
      });
      if (!inserted) {
        hash = generateHash();
        inserted = db.insertUpload({
          hash,
          originalName: filename,
          sizeBytes: buffer.length,
          ip,
          createdAt: now,
          uploadedBy,
        });
      }
      if (!inserted) {
        request.log.error({ hash }, 'hash collision after retry');
        return reply.code(500).send({ error: 'storage_failure' });
      }
      try {
        await storage.saveHtml(hash, buffer);
      } catch (err) {
        request.log.error({ err }, 'storage write failed');
        return reply.code(500).send({ error: 'storage_failure' });
      }
      results.push({
        hash,
        originalName: filename,
        sizeBytes: buffer.length,
        url: buildPreviewUrl(config.publicHost, config.basePath, hash),
      });
    }

    return reply.code(201).send({
      uploads: results,
      remaining: consume.remaining,
      limit: consume.limit,
    });
  });
}
