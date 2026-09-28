import config from '../../../src/configs/config';
import logger from '../../../src/configs/logger';
import * as email from '../../../src/services/common/email.service';

// 13b: one switch for every email (EMAIL_TRANSPORT = smtp | log), no per-feature exceptions.

const sendMail = jest.fn(async () => ({ messageId: 'x' }));
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail, verify: async () => true }) } }));

const LINK = 'http://localhost:3000/some-page?token=abc123';
const pdf = { filename: 'x.pdf', content: Buffer.from('%PDF') };

/** Every email type the app sends, with the recipient it goes to. */
const EMAILS: { kind: string; to: string; send: () => Promise<unknown>; link?: string }[] = [
	{ kind: 'verification', to: 'verify.me@example.com', send: () => email.sendVerificationLinkEmail('verify.me@example.com', LINK), link: LINK },
	{ kind: 'password_reset', to: 'reset.me@example.com', send: () => email.sendForgotPasswordOTP('reset.me@example.com', '123456') },
	{ kind: 'invitation', to: 'invite.me@example.com', send: () => email.sendInvitationEmail('invite.me@example.com', LINK, 'Acme', 'member'), link: LINK },
	{
		kind: 'report',
		to: 'report.me@example.com',
		send: () => email.sendReportEmail({ to: ['report.me@example.com'], subject: 'Report', text: 't', html: '<p>t</p>', senderName: 'Acme', replyTo: null, attachment: pdf }),
	},
	{ kind: 'billing', to: 'bill.me@example.com', send: () => email.sendBillingEmail({ to: 'bill.me@example.com', subject: 'Invoice', text: 't', html: '<p>t</p>', attachment: pdf }) },
	{ kind: 'admin', to: 'admin.me@example.com', send: () => email.sendAdminCredential('admin.me@example.com', 'temp-password', 'Admin') },
	{ kind: 'contact', to: 'contact.me@example.com', send: () => email.sendContactUsConfirmationMail('contact.me@example.com', 'Pat') },
	{ kind: 'contact', to: 'support@example.com', send: () => email.sendContactUsAdminMail('Pat', 'Acme', 'pat@example.com', '1', 'w', 'l', 's', 'p', 'g') },
];

const original = { transport: config.email.transport, supportInbox: config.email.supportInbox };
let info: jest.SpyInstance;
beforeEach(() => {
	sendMail.mockClear();
	info = jest.spyOn(logger, 'info');
	config.email.supportInbox = 'support@example.com';
});
afterEach(() => {
	info.mockRestore();
	Object.assign(config.email, original);
});

describe('EMAIL_TRANSPORT', () => {
	it('defaults to log outside production', () => {
		expect(original.transport).toBe('log');
	});

	it.each(EMAILS.map((e) => [e.kind, e.to, e] as const))('log: %s to %s is logged (recipient masked, link shown), not sent', async (_kind, to, e) => {
		config.email.transport = 'log';
		await e.send();
		expect(sendMail).not.toHaveBeenCalled();
		const logged = info.mock.calls.map((c) => String(c[0])).join('\n');
		expect(logged).toContain(`email [${e.kind}] not sent (EMAIL_TRANSPORT=log)`);
		expect(logged).toContain(email.maskEmail(to));
		expect(logged).not.toContain(to);
		if (e.link) expect(logged).toContain(e.link);
	});

	it.each(EMAILS.map((e) => [e.kind, e.to, e] as const))('smtp: %s to %s is sent through SMTP', async (_kind, to, e) => {
		config.email.transport = 'smtp';
		await e.send();
		expect(sendMail).toHaveBeenCalledTimes(1);
		const message = (sendMail.mock.calls[0] as unknown as [{ to: string[] }])[0];
		expect(message.to).toEqual([to]);
		const logged = info.mock.calls.map((c) => String(c[0])).join('\n');
		expect(logged).not.toContain(to);
		if (e.link) expect(logged).not.toContain(e.link);
	});

	it('smtp: attachments go with the message; deliver() reports sent', async () => {
		config.email.transport = 'smtp';
		expect(await email.sendBillingEmail({ to: 'a@example.com', subject: 's', text: 't', html: 'h', attachment: pdf })).toBe(true);
		expect(sendMail.mock.calls[0]).toMatchObject([{ attachments: [{ filename: 'x.pdf', contentType: 'application/pdf' }] }]);
		config.email.transport = 'log';
		expect(await email.sendBillingEmail({ to: 'a@example.com', subject: 's', text: 't', html: 'h', attachment: pdf })).toBe(false);
	});

	it('the support-inbox notification is skipped when SUPPORT_EMAIL is empty', async () => {
		config.email.transport = 'smtp';
		config.email.supportInbox = '';
		await email.sendContactUsAdminMail('Pat', 'Acme', 'pat@example.com', '1', 'w', 'l', 's', 'p', 'g');
		expect(sendMail).not.toHaveBeenCalled();
	});
});
