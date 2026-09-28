import nodemailer, { Transporter } from 'nodemailer';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { contactUsAdminEmailFormat, contactUsConfirmationEmailFormat } from '../../constants/Contactusemailformat';

// Every email the app sends goes through deliver() (13b, Mohit 2026-09-29): one switch, EMAIL_TRANSPORT.
//   smtp: sent through the SMTP server (the default in production).
//   log:  not sent; one log line with the kind, subject, masked recipients and the link (default in development
//         and test). There are no per-feature exceptions: setting smtp in development sends every kind for real.

export type EmailKind = 'verification' | 'password_reset' | 'invitation' | 'report' | 'billing' | 'admin' | 'contact' | 'support';

export interface OutgoingEmail {
  kind: EmailKind;
  to: string | string[];
  subject: string;
  text: string;
  html: string;
  /** Display name for the From header; the address is always EMAIL_FROM's (SPF/DKIM). */
  fromName?: string;
  replyTo?: string | null;
  attachments?: { filename: string; content: Buffer; contentType: string }[];
  /** The one link that matters (verify, reset, invitation, share); shown in log mode. */
  link?: string | null;
}

/** j***@example.com */
export const maskEmail = (email: string): string => {
  const [local, domain] = email.split('@');
  return `${local.slice(0, 1)}***@${domain ?? ''}`;
};

/** The bare address of EMAIL_FROM ("Name <a@b>" or "a@b"). */
const fromAddress = (): string => /<([^>]+)>/.exec(config.email.from ?? '')?.[1] ?? config.email.from ?? '';

let smtp: Transporter | null = null;
const smtpTransport = (): Transporter => {
  if (!smtp) smtp = nodemailer.createTransport(config.email.smtp);
  return smtp;
};

if (config.email.transport === 'smtp' && config.essentials.env !== 'test') {
  smtpTransport()
    .verify()
    .then(() => logger.info('email: connected to the SMTP server'))
    .catch(() => logger.warn('email: unable to connect to the SMTP server; check the SMTP_* settings'));
} else if (config.email.transport === 'log' && config.essentials.env === 'production') {
  logger.warn('email: EMAIL_TRANSPORT=log in production: no email is sent and links are written to the log');
}

/**
 * Sends (smtp) or logs (log) one email. Throws on an SMTP failure; the send* helpers below decide whether a
 * caller sees it. Log mode counts as delivered: the email went through the configured transport.
 */
export const deliver = async (mail: OutgoingEmail): Promise<void> => {
  const to = Array.isArray(mail.to) ? mail.to : [mail.to];
  if (config.email.transport === 'log') {
    const extra = mail.attachments?.length ? ` (+${mail.attachments.length} attachment)` : '';
    logger.info(`email [${mail.kind}] not sent (EMAIL_TRANSPORT=log): "${mail.subject}" to ${to.map(maskEmail).join(', ')}${extra}${mail.link ? `: ${mail.link}` : ''}`);
    return;
  }
  await smtpTransport().sendMail({
    from: { name: (mail.fromName ?? config.essentials.appName ?? 'MyPageSEO').replace(/["<>]/g, ''), address: fromAddress() },
    to,
    replyTo: mail.replyTo ?? undefined,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments ?? [],
  });
  logger.info(`email [${mail.kind}] sent to ${to.length} recipient(s)`);
};

/** deliver(), but an SMTP failure is logged and reported as false instead of thrown; true otherwise (sent or logged). */
const deliverQuietly = async (mail: OutgoingEmail): Promise<boolean> => {
  try {
    await deliver(mail);
    return true;
  } catch (err) {
    logger.error(`email [${mail.kind}] could not be sent: ${(err as Error).message}`);
    return false;
  }
};

const esc = (s: string): string => s.replace(/[<>&"]/g, '');

/** Phase 8.1: the email verification link (FRONTEND_URL/verify-email?token=…). */
export const sendVerificationLinkEmail = async (to: string, link: string): Promise<boolean> => {
  const hours = config.auth.emailVerificationTtlHours;
  return deliverQuietly({
    kind: 'verification',
    to,
    link,
    subject: 'Verify your email for MyPageSEO',
    text: `Welcome to MyPageSEO. Verify your email to activate your account: ${link}\nThe link expires in ${hours} hours. If you didn't sign up, ignore this email and the account will be deleted.`,
    html: `<p>Welcome to MyPageSEO.</p><p><a href="${link}">Verify your email</a> to activate your account.</p><p>The link expires in ${hours} hours. If you didn't sign up, ignore this email and the account will be deleted.</p>`,
  });
};

/** 13b: the password-reset link (FRONTEND_URL/reset-password?token=…). */
export const sendPasswordResetLinkEmail = async (to: string, link: string): Promise<boolean> => {
  const minutes = config.auth.passwordResetTtlMinutes;
  return deliverQuietly({
    kind: 'password_reset',
    to,
    link,
    subject: 'Reset your MyPageSEO password',
    text: `Someone asked to reset the password of your MyPageSEO account. Choose a new password: ${link}\nThe link works once and expires in ${minutes} minutes. If it wasn't you, ignore this email; your password stays the same.`,
    html: `<p>Someone asked to reset the password of your MyPageSEO account.</p><p><a href="${link}">Choose a new password</a></p><p>The link works once and expires in ${minutes} minutes. If it wasn't you, ignore this email; your password stays the same.</p>`,
  });
};

/** Phase 11: a team invitation. The link carries the one-time token. */
export const sendInvitationEmail = async (to: string, link: string, organizationName: string, role: string): Promise<boolean> => {
  const roleLabel = role === 'client_user' ? 'a client' : 'a team member';
  const days = config.auth.invitationTtlDays;
  return deliverQuietly({
    kind: 'invitation',
    to,
    link,
    subject: `You're invited to ${organizationName} on MyPageSEO`,
    text: `You have been invited to join ${organizationName} on MyPageSEO as ${roleLabel}. Accept the invitation: ${link}\nThe link expires in ${days} days.`,
    html: `<p>You have been invited to join <strong>${esc(organizationName)}</strong> on MyPageSEO as ${roleLabel}.</p><p><a href="${link}">Accept the invitation</a></p><p>The link expires in ${days} days.</p>`,
  });
};

/**
 * Phase 12: a report email. The display name and Reply-To come from the organization's branding.
 * Throws on an SMTP failure so the caller can record it.
 */
export const sendReportEmail = async (input: {
  to: string[];
  subject: string;
  text: string;
  html: string;
  senderName: string;
  replyTo: string | null;
  attachment: { filename: string; content: Buffer } | null;
  link?: string | null;
}): Promise<void> =>
  deliver({
    kind: 'report',
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    fromName: input.senderName,
    replyTo: input.replyTo,
    link: input.link ?? null,
    attachments: input.attachment ? [{ filename: input.attachment.filename, content: input.attachment.content, contentType: 'application/pdf' }] : [],
  });

/** Phase 13a: billing emails (receipts, invoices, payment problems, trial reminders). Throws on an SMTP failure. */
export const sendBillingEmail = async (input: { to: string; subject: string; text: string; html: string; attachment: { filename: string; content: Buffer } | null; link?: string | null }): Promise<void> =>
  deliver({
    kind: 'billing',
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    fromName: 'MyPageSEO Billing',
    link: input.link ?? null,
    attachments: input.attachment ? [{ filename: input.attachment.filename, content: input.attachment.content, contentType: 'application/pdf' }] : [],
  });

/**
 * 13b: an admin password link (ADMIN_FRONTEND_URL/reset-password?token=…): 'welcome' for a new admin
 * (sets the first password; replaces the emailed temporary password), 'reset' for forgot-password.
 */
export const sendAdminPasswordLinkEmail = async (to: string, link: string, purpose: 'welcome' | 'reset'): Promise<boolean> => {
  const welcome = purpose === 'welcome';
  const expiry = welcome ? `${config.auth.adminSetPasswordTtlHours} hours` : `${config.auth.passwordResetTtlMinutes} minutes`;
  const intro = welcome ? 'An administrator account was created for you on the MyPageSEO admin panel.' : 'Someone asked to reset the password of your MyPageSEO admin account.';
  const action = welcome ? 'Set your password' : 'Choose a new password';
  return deliverQuietly({
    kind: 'admin',
    to,
    link,
    subject: welcome ? 'Your MyPageSEO admin account' : 'Reset your MyPageSEO admin password',
    text: `${intro} ${action}: ${link}\nThe link works once and expires in ${expiry}.`,
    html: `<p>${intro}</p><p><a href="${link}">${action}</a></p><p>The link works once and expires in ${expiry}.</p>`,
  });
};

export const sendContactUsConfirmationMail = async (to: string, name: string): Promise<void> => {
  await deliver({
    kind: 'contact',
    to,
    subject: `We Received Your Inquiry - ${config.essentials.appName}`,
    text: `Hi ${name}, thank you for contacting ${config.essentials.appName}. We've received your inquiry and will get back to you shortly.`,
    html: contactUsConfirmationEmailFormat(name),
  });
};

/** The contact-form notification to the support inbox (SUPPORT_EMAIL; skipped when it is empty). */
export const sendContactUsAdminMail = async (
  full_name: string,
  business_name: string,
  email: string,
  phone_number: string,
  business_website: string,
  business_location: string,
  company_size: string,
  primary_interest: string,
  goals_or_challenges: string,
): Promise<void> => {
  if (!config.email.supportInbox) return;
  await deliver({
    kind: 'contact',
    to: config.email.supportInbox,
    replyTo: email,
    subject: `New Contact Us Inquiry - ${config.essentials.appName}`,
    text: `New Contact Us inquiry from ${full_name} (${business_name}, ${email}).`,
    html: contactUsAdminEmailFormat(full_name, business_name, email, phone_number, business_website, business_location, company_size, primary_interest, goals_or_challenges),
  });
};
