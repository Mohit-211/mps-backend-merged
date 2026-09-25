/* eslint-disable @typescript-eslint/no-explicit-any */
import nodemailer from 'nodemailer';
import httpStatus from 'http-status';
import config from '../../configs/config';
import logger from '../../configs/logger';
import { forgotPasswordSendOTPFormat, emailVerificationFormat, adminCredentialsEmailFormat } from '../../constants';
import { ApiError } from '../../utils';
import subscriptionWelcomeEmailFormat from '../../constants/subscriptionwelcomeemailformat';
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

const sendEmail = async (to: string, subject: string, text: string): Promise<void> => {
  try {
    const msg: EmailOptions = { from: config.email.from, to, subject, text };
    await transport.sendMail(msg);
  } catch (error: any) {
    throw new ApiError(error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR, error.message);
  }
};

export const sendEmailVerification = async (to: string, otp: string): Promise<boolean> => {
  try {
    const message: EmailOptions = {
      from: `${config.email.from}`,
      to: `${to}`,
      subject: 'Please verify your email',
      text: `Please click on the following link to verify your email`,
      html: emailVerificationFormat(otp),
    };
    await transport.sendMail(message);
    return true;
  } catch (error: any) {
    logger.error('Email sent error: ', error);
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

export const sendResetPasswordConfirmationMail = async (to: string): Promise<void> => {
  try {
    const subject = 'Successfully Changed password';
    const text = `Dear user,
        Your Password Has Been changed Successfully
        If you did not request any password resets, then ignore this email.`;
    await sendEmail(to, subject, text);
  } catch (error: any) {
    throw new ApiError(error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR, error.message);
  }
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

export const sendSubscriptionWelcomeMail = async (
  to: string,
  name?: string,
): Promise<void> => {
  try {
    const customerName = name?.trim() || 'Anshita Testing';

    const subject = `Welcome to MyPageSEO 🚀`;
    const adminEmail = 'mohit@mypageseo.com';

    const text = `Hi ${customerName},
Welcome to MyPageSeo! 🎉
Thank you for choosing MyPageSeo to help grow your business and improve your visibility on Google.
We have successfully received your payment, and your onboarding is now underway. Our team will review your details and reach out to you shortly to get everything started.
During the onboarding process, we will understand your business, target locations, services, and goals so we can build the right local SEO strategy for you.

What happens next?
• Our team will contact you shortly
• We will collect the information needed to get started
• We will set up and optimize your local SEO campaign
• You will receive regular updates and reports on your progress

If you have any questions in the meantime, simply reply to this email and our team will be happy to help.

Once again, welcome to MyPageSeo. We are excited to work with you and help your business get found by more local customers.

Best regards,
Team MyPageSEO`;

    const html = subscriptionWelcomeEmailFormat(customerName);

    const message: EmailOptions = {
      from: `${config.email.from}`,
      to,
      subject,
      text,
      html,
    };

    const adminMessage: EmailOptions = {
      from: `${config.email.from}`,
      to: adminEmail,
      subject,
      text,
      html,
    };

    await Promise.all([
      transport.sendMail(message),
      transport.sendMail(adminMessage),
    ]);
  } catch (error: any) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message,
    );
  }
};

export const sendSubscriptionRenewalMail = async (
	to: string,
	name: string,
	planName: string,
	amount: number,
): Promise<void> => {
	try {
		const subject = "Payment Received - My Page SEO";

		const text = `
Hi ${name},

We've successfully received your recurring subscription payment.

----------------------------------------
Payment Details
----------------------------------------

Plan: ${planName}

Amount: $${amount}

Status: Successful

----------------------------------------

Thank you for continuing your subscription with My Page SEO.

No further action is required.

If you have any questions, simply reply to this email.

Regards,

My Page SEO Team
https://mypageseo.com
`;

		await sendEmail(to, subject, text);
	} catch (error: any) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
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