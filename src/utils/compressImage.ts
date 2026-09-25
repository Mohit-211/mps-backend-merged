/* eslint-disable @typescript-eslint/no-explicit-any */
// Assuming you are using express and multer together
// npm install fluent-ffmpeg ffmpeg-static
import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { UploadedFile } from '../types/interfaces';

const PUBLIC_DIR = path.resolve(
	__dirname,
	process.env.NODE_ENV === 'development' ? '../../public' : '../../../public',
);

const deleteFile = (fullPath: string) => {
	return new Promise((resolve, reject) => {
		fs.unlink(path.resolve(fullPath), (err: any) => {
			if (err) {
				reject(err);
			} else {
				resolve('Successfully Deleted Original Image');
			}
		});
	});
};

const compressImage = async (
	file: UploadedFile,
	destPath: string,
): Promise<void> => {
	const compressionSettings = {
		quality: 70,
	};

	const compressedFileName = `compressed_${file.filename}`;
	const compressedFilePath = path.join(destPath, compressedFileName);

	sharp.cache(false);
	await sharp(file.path).jpeg(compressionSettings).toFile(compressedFilePath);

	// Delete the original image after compression
	await deleteFile(file.path);

	// Update filename and path to the compressed version
	file.filename = compressedFileName;
	file.path = compressedFilePath;
};

export const handleImageCompression = async (
	req: Request,
	res: Response,
	next: NextFunction,
): Promise<void> => {
	try {
		const files = req.files as
			| Record<string, UploadedFile[]>
			| UploadedFile[];

		// Check if 'images' field exists in files
		if (files && 'images' in files) {
			const imagesArr = files.images as UploadedFile[];

			// Array to store compressed images
			const newArr = [];

			// Iterate over imagesArr using for...of loop
			for (const currImage of imagesArr) {
				// Compress the current image
									await compressImage(
						currImage,
						path.join(PUBLIC_DIR, 'uploads', 'images'),
					);

					newArr.push(currImage);
			}

			// Update req.files.images with compressed images
			(req as any).files.images = newArr;

			next();
		} else {
			next();
		}
	} catch (error) {
		next(error);
	}
};

export default handleImageCompression;