import { hashPassword, verifyPassword } from '../auth/crypto.js';
import { signToken, verifyToken } from '../auth/token.js';
import { sendVerificationEmail } from '../auth/email.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function authRoutes(app) {
  const { config } = app;

  const setTokenCookie = (reply, email) => {
    const token = signToken({ email }, config.tokenSecret, config.tokenExpirySeconds);
    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.publicHost.startsWith('https'),
      maxAge: config.tokenExpirySeconds,
    });
  };

  app.post('/api/auth/send-code', async (request, reply) => {
    const { email } = request.body || {};
    if (!email || !EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: 'invalid_email' });
    }

    const user = app.db.getUser(email);
    if (user && user.verified) {
      return reply.code(409).send({ error: 'email_already_registered' });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + config.verificationCodeExpirySeconds * 1000;

    if (!user) {
      const passwordHash = hashPassword(crypto_random_str(32));
      app.db.createUser(email, passwordHash);
    }

    app.db.createVerificationCode(email, code, expiresAt);

    try {
      await sendVerificationEmail({
        to: email,
        code,
        log: request.log,
        config,
      });
    } catch (err) {
      request.log.error({ err }, 'Failed to send verification email');
    }

    return reply.send({ ok: true });
  });

  app.post('/api/auth/verify-and-register', async (request, reply) => {
    const { email, code, password } = request.body || {};
    if (!email || !EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: 'invalid_email' });
    }
    if (!code || !/^\d{6}$/.test(code)) {
      return reply.code(400).send({ error: 'invalid_code' });
    }
    if (!password || password.length < 6) {
      return reply.code(400).send({ error: 'password_too_short' });
    }

    const user = app.db.getUser(email);
    if (!user) {
      return reply.code(404).send({ error: 'user_not_found' });
    }
    if (user.verified) {
      return reply.code(409).send({ error: 'email_already_registered' });
    }

    const validCode = app.db.validateCode(email, code);
    if (!validCode) {
      return reply.code(400).send({ error: 'invalid_or_expired_code' });
    }

    app.db.transaction(() => {
      const passwordHash = hashPassword(password);
      app.db.setPasswordAndVerify(email, passwordHash);
      app.db.markCodeUsed(validCode.id);
    })();

    setTokenCookie(reply, email);
    return reply.send({ ok: true, email });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body || {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'email_password_required' });
    }

    const user = app.db.getUser(email);
    if (!user || !user.verified) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    if (!verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }

    setTokenCookie(reply, email);
    return reply.send({ ok: true, email });
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.setCookie('token', '', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.publicHost.startsWith('https'),
      maxAge: 0,
    });
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    return reply.send({ email: request.user.email });
  });
}

function crypto_random_str(len) {
  return Array.from({ length: len }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
      Math.floor(Math.random() * 62),
    ),
  ).join('');
}
