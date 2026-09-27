import express, { Request, Response } from 'express';
import httpStatus from 'http-status';
import logger from '../configs/logger';
import { reportService } from '../services/reports/report.service';
import { renderSharePage } from '../services/reports/render/html';
import { ShareNotFound, shareService, shareUrl } from '../services/reports/share.service';
import { ApiError } from '../utils';

// Public report share links (Phase 12), mounted at /r (outside /api/v1, no login). GET /r/:token is a
// branded HTML view, GET /r/:token/pdf the PDF. noindex, no scripts, no internal ids; every failure
// gives the same 404 page. Rate-limited per IP (60 / minute). The request logger redacts the token.
const router = express.Router();

const SECURITY_HEADERS: Record<string, string> = {
	'X-Robots-Tag': 'noindex, nofollow, noarchive',
	'Cache-Control': 'private, no-store',
	'Referrer-Policy': 'no-referrer',
	'X-Content-Type-Options': 'nosniff',
	'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const page = (title: string, text: string) =>
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title><style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111827;background:#f3f4f6;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:16px}div{background:#fff;padding:24px;border-radius:8px;max-width:420px}</style></head><body><div><h1 style="font-size:20px;margin:0 0 8px">${title}</h1><p style="margin:0;color:#6b7280">${text}</p></div></body></html>`;

const clientIp = (req: Request): string => (req as Request & { clientIp?: string }).clientIp ?? req.ip ?? 'unknown';

const fail = (res: Response, err: unknown) => {
	if (err instanceof ApiError && err.statusCode === httpStatus.TOO_MANY_REQUESTS) {
		res.status(httpStatus.TOO_MANY_REQUESTS).type('html').send(page('Too many requests', 'Please wait a minute and try again.'));
		return;
	}
	if (!(err instanceof ShareNotFound)) logger.error(`share link: ${(err as Error).message}`);
	res.status(httpStatus.NOT_FOUND).type('html').send(page('Report not available', 'This link has expired, was revoked, or does not exist.'));
};

router.get('/:token', async (req, res) => {
	res.set(SECURITY_HEADERS);
	try {
		const { report, snapshot } = await shareService.resolve(req.params.token, clientIp(req));
		const doc = reportService.documentOf(report, snapshot);
		res.status(httpStatus.OK).type('html').send(renderSharePage(doc, `${shareUrl(req.params.token)}/pdf`));
	} catch (err) {
		fail(res, err);
	}
});

router.get('/:token/pdf', async (req, res) => {
	res.set(SECURITY_HEADERS);
	try {
		const { report } = await shareService.resolve(req.params.token, clientIp(req), false);
		const { data, filename } = await reportService.readPdf(report);
		res.set({ 'Content-Type': 'application/pdf', 'Content-Length': String(data.length), 'Content-Disposition': `attachment; filename="${filename}"` });
		res.status(httpStatus.OK).end(data);
	} catch (err) {
		fail(res, err);
	}
});

export default router;
