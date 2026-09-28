/* eslint-disable @typescript-eslint/no-explicit-any */
import nodemailer from 'nodemailer';
import httpStatus from 'http-status';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { forgotPasswordSendOTPFormat, adminCredentialsEmailFormat } from '../../constants';
import { ApiError } from '../../utils';
import { contactUsAdminEmailFormat, contactUsConfirmationEmailFormat } from '../../constants/Contactusemailformat';

// Type definition for sendEmail function parameters
interface EmailOptions {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const transport = nodemailer.createTransport(config.email.smtp);

if (config.essentials.env !== 'test') {
  transport
    .verify()
    .then(() => logger.info('Connected to email server successfully😊.'))
    .catch(() =>
      logger.warn('Unable to connect to email server. Make sure you have configured the SMTP options in .env 🥺')
    );
}


/** Phase 8.1: the email verification link (FRONTEND_URL/verify-email?token=…). The link is never logged here. */
export const sendVerificationLinkEmail = async (to: string, link: string): Promise<boolean> => {
  try {
    const hours = config.auth.emailVerificationTtlHours;
    await transport.sendMail({
      from: `${config.email.from}`,
      to,
      subject: 'Verify your email for MyPageSEO',
      text: `Welcome to MyPageSEO. Verify your email to activate your account: ${link}\nThe link expires in ${hours} hours. If you didn't sign up, ignore this email and the account will be deleted.`,
      html: `<p>Welcome to MyPageSEO.</p><p><a href="${link}">Verify your email</a> to activate your account.</p><p>The link expires in ${hours} hours. If you didn't sign up, ignore this email and the account will be deleted.</p>`,
    });
    return true;
  } catch {
    logger.error('Verification email could not be sent');
    return false;
  }
};

export const sendForgotPasswordOTP = async (to: string, otp: string): Promise<boolean> => {
  try {
    const message: EmailOptions = {
      from: `${config.email.from}`,
      to: `${to}`,
      subject: 'Forget Password Request',
      text: `Please click on the following link to verify your email`,
      html: forgotPasswordSendOTPFormat(otp),
    };
    await transport.sendMail(message);
    return true;
  } catch (error: any) {
    logger.error('Email sent error: ', error);
    return false;
  }
};

/** Phase 11: a team invitation. The link carries the one-time token; it is never logged here. */
export const sendInvitationEmail = async (to: string, link: string, organizationName: string, role: string): Promise<boolean> => {
  try {
    const roleLabel = role === 'client_user' ? 'a client' : 'a team member';
    await transport.sendMail({
      from: `${config.email.from}`,
      to,
      subject: `You're invited to ${organizationName} on MyPageSEO`,
      text: `You have been invited to join ${organizationName} on MyPageSEO as ${roleLabel}. Accept the invitation: ${link}\nThe link expires in ${config.auth.invitationTtlDays} days.`,
      html: `<p>You have been invited to join <strong>${organizationName.replace(/[<>&"]/g, '')}</strong> on MyPageSEO as ${roleLabel}.</p><p><a href="${link}">Accept the invitation</a></p><p>The link expires in ${config.auth.invitationTtlDays} days.</p>`,
    });
    return true;
  } catch {
    logger.error('Invitation email could not be sent');
    return false;
  }
};

/** The bare address of EMAIL_FROM ("Name <a@b>" or "a@b"). */
const fromAddress = (): string => /<([^>]+)>/.exec(config.email.from ?? '')?.[1] ?? config.email.from;

/**
 * Phase 12: a report email. The From address stays EMAIL_FROM (SPF/DKIM); the display name and
 * Reply-To come from the organization's branding. Throws on failure so the caller can record it.
 */
export const sendReportEmail = async (input: {
  to: string[];
  subject: string;
  text: string;
  html: string;
  senderName: string;
  replyTo: string | null;
  attachment: { filename: string; content: Buffer } | null;
}): Promise<void> => {
  await transport.sendMail({
    from: { name: input.senderName.replace(/["<>]/g, ''), address: fromAddress() },
    to: input.to,
    replyTo: input.replyTo ?? undefined,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachment ? [{ filename: input.attachment.filename, content: input.attachment.content, contentType: 'application/pdf' }] : [],
  });
};

/** Phase 13a: billing emails (receipts, invoices, payment problems, trial reminders). Throws on failure. */
export const sendBillingEmail = async (input: { to: string; subject: string; text: string; html: string; attachment: { filename: string; content: Buffer } | null }): Promise<void> => {
  await transport.sendMail({
    from: { name: 'MyPageSEO Billing', address: fromAddress() },
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachment ? [{ filename: input.attachment.filename, content: input.attachment.content, contentType: 'application/pdf' }] : [],
  });
};

export const sendAdminCredential = async (to: string, password: string, role: string): Promise<boolean> => {
  try {
    const message: EmailOptions = {
      from: `${config.email.from}`,
      to: `${to}`,
      subject: `Added New ${role} Account`,
      text: `Please note your credential for login and continue your journey.`,
      html: adminCredentialsEmailFormat(to, password, role),
    };
    await transport.sendMail(message);
    return true;
  } catch (error: any) {
    logger.error('Email sent error: ', error);
    return false;
  }
};

export const sendContactUsConfirmationMail = async (
  to: string,
  name: string,
): Promise<void> => {
  try {
    const subject = `We Received Your Inquiry - ${config.essentials.appName}`;

    const message: EmailOptions = {
      from: `${config.email.from}`,
      to: `${to}`,
      subject,
      text: `Hi ${name}, thank you for contacting ${config.essentials.appName}. We've received your inquiry and will get back to you shortly.`,
      html: contactUsConfirmationEmailFormat(name),
    };

    await transport.sendMail(message);
  } catch (error: any) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message,
    );
  }
};

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
  try {
    const subject = `New Contact Us Inquiry - ${config.essentials.appName}`;

    const message: EmailOptions = {
      from: `${config.email.from}`,
      to: 'mohit@mypageseo.com',
      subject,
      text: `New Contact Us inquiry from ${full_name} (${business_name}, ${email}).`,
      html: contactUsAdminEmailFormat(
        full_name,
        business_name,
        email,
        phone_number,
        business_website,
        business_location,
        company_size,
        primary_interest,
        goals_or_challenges,
      ),
    };

    await transport.sendMail(message);
  } catch (error: any) {
    throw new ApiError(
      error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
      error.message,
    );
  }
};