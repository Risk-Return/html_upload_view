import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter(config) {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });

  return transporter;
}

export async function sendVerificationEmail({ to, code, log, config }) {
  if (!config.smtpUser || !config.smtpPass) {
    log.warn('SMTP credentials not configured, skipping email send');
    return { sent: false, reason: 'not_configured' };
  }

  const transport = getTransporter(config);

  await transport.sendMail({
    from: config.smtpFrom,
    to,
    subject: 'HTML Vault — Verification Code',
    html: `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 10 minutes.</p>`,
  });

  log.info({ to }, 'Verification email sent');
  return { sent: true };
}
