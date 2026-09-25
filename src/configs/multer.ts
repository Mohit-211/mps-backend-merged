/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/consistent-indexed-object-style */
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils';
import httpStatus from 'http-status';

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

// Init upload
const upload = multer({
	storage: storage,
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

const uploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
	upload(req, res, (err: any) => {
		if (err instanceof multer.MulterError) {
			if (err.code === 'LIMIT_UNEXPECTED_FILE') {
				return next();
			}
			return next(new ApiError(httpStatus.BAD_REQUEST, err.message));
		} else if (err) {
			return next(new ApiError(httpStatus.INTERNAL_SERVER_ERROR, err.message));
		}
		next();
	});
};

export default uploadMiddleware;