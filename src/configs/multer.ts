/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/consistent-indexed-object-style */
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils';
import httpStatus from 'http-status';
import handleImageCompression from '../utils/compressImage';

const createDirectory = (dir: string) => {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
};

const PUBLIC_DIR = path.resolve(
	__dirname,
	process.env.NODE_ENV === 'development' ? '../../public' : '../../../public',
);

// Function to determine destination based on field name
const getDestination = (fileField: string): string => {
	switch (fileField) {
		case 'videos':
			return 'videos';
		case 'images':
			return 'images';
		case 'gifs':
			return 'gifs';
		case 'docs':
			return 'docs';
		case 'audios':
			return 'audios';
		default:
			throw new Error('Invalid field name');
	}
};

// Set storage engine
const storage = multer.diskStorage({
	destination: (req: Request, file, cb) => {
		try {
			const fileField = file.fieldname as string;
			const destFolder = getDestination(fileField);
			const filePath = path.join(PUBLIC_DIR, 'uploads', destFolder);
			createDirectory(filePath);
			cb(null, filePath);
		} catch (error) {
			cb(error, '');
		}
	},
	filename: (
		req: Request,
		file: Express.Multer.File,
		cb: (error: Error | null, filename: string) => void,
	): void => {
		const ext = getFileExtension(file);
		cb(null, `${file.fieldname}-${Date.now()}.${ext}`);
	},
});

// Check file type
const checkFileType = (
	file: Express.Multer.File,
	cb: FileFilterCallback,
): void => {
	const allowedFiletypes = [
		'jpeg', 'jpg', 'png', 'gif', 'mp4', 'mov', 'pdf', 'mp3', 'doc', 'docx',
	];
	const fileExtension = path.extname(file.originalname).toLowerCase().substring(1);
	const isValidExtension = allowedFiletypes.includes(fileExtension);
	const isValidMimeType =
		file.mimetype.startsWith('image/') ||
		file.mimetype.startsWith('video/') ||
		file.mimetype.startsWith('application/pdf') ||
		file.mimetype.startsWith('audio/') ||
		file.mimetype === 'application/msword' ||
		file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

	if (isValidExtension && isValidMimeType) {
		cb(null, true);
	} else {
		cb(
			new Error(
				'Error: Images (.jpeg, .jpg, .png), videos (.mp4, .mov), Audio (.mp3), and File (.pdf, .doc, .docx) only allow!',
			),
		);
	}
};

const getFileExtension = (file: Express.Multer.File): string => {
	const mimeToExtMap: { [key: string]: string } = {
		'image/jpeg': 'jpg',
		'image/jpg': 'jpg',
		'image/png': 'png',
		'image/gif': 'gif',
		'video/mp4': 'mp4',
		'video/mov': 'mov',
		'application/pdf': 'pdf',
		'audio/mpeg': 'mp3',
		'application/msword': 'doc',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	};
	return mimeToExtMap[file.mimetype] || 'txt';
};

// Phase 10 (AUDIT S7): uploads only on the routes that take files, after authentication, with limits.
export const UPLOAD_LIMITS = { fileSize: 10 * 1024 * 1024, files: 10, fields: 100, fieldSize: 1024 * 1024 };

const upload = multer({
	storage: storage,
	limits: UPLOAD_LIMITS,
	fileFilter: (
		req: Request,
		file: Express.Multer.File,
		cb: FileFilterCallback,
	): void => {
		checkFileType(file, cb);
	},
}).fields([
	{ name: 'gifs', maxCount: 10 },
	{ name: 'images', maxCount: 10 },
	{ name: 'videos', maxCount: 10 },
	{ name: 'docs', maxCount: 10 },
	{ name: 'audios', maxCount: 10 },
]);

const toApiError = (err: unknown): ApiError =>
	err instanceof multer.MulterError
		? new ApiError(httpStatus.BAD_REQUEST, err.code === 'LIMIT_FILE_SIZE' ? 'A file is larger than 10 MB.' : err.message)
		: new ApiError(httpStatus.BAD_REQUEST, err instanceof Error ? err.message : 'Invalid upload');

/** Files (and text fields) for the upload routes; images are then compressed. Mount AFTER the auth middleware. */
export const uploadFiles = [
	(req: Request, res: Response, next: NextFunction) => upload(req, res, (err: unknown) => (err ? next(toApiError(err)) : next())),
	handleImageCompression,
];

/** The routes that accept files (they mount uploadFiles themselves, after auth). */
const FILE_ROUTES: { method: string; path: RegExp }[] = [
	{ method: 'POST', path: /^\/api\/v1\/blog\/?$/ },
	{ method: 'PUT', path: /^\/api\/v1\/blog\/[^/]+\/?$/ },
	{ method: 'POST', path: /^\/api\/v1\/white-label-profiles\/?$/ },
	{ method: 'PATCH', path: /^\/api\/v1\/white-label-profiles\/?$/ },
	{ method: 'POST', path: /^\/api\/v1\/gbp\/post\/add\/?$/ },
];

const fieldsOnly = multer({ limits: { ...UPLOAD_LIMITS, files: 0 } }).none();

/**
 * Global on /api/v1: parses the text fields of multipart requests (the old global upload did, and forms
 * may still post FormData) but refuses files; no disk writes before authentication.
 */
export const multipartFieldsOnly = (req: Request, res: Response, next: NextFunction) => {
	if (!req.is('multipart/form-data')) return next();
	const url = req.originalUrl.split('?')[0];
	if (FILE_ROUTES.some((r) => r.method === req.method && r.path.test(url))) return next();
	fieldsOnly(req, res, (err: unknown) => {
		if (err instanceof multer.MulterError && (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT')) {
			return next(new ApiError(httpStatus.BAD_REQUEST, 'This endpoint does not accept files.'));
		}
		return err ? next(toApiError(err)) : next();
	});
};
