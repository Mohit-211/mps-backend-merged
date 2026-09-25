/* eslint-disable @typescript-eslint/no-unused-vars */
import express, { Request, Response, NextFunction } from "express";
import bodyParser from "body-parser";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";

const CryptoAlgorithm = "aes-256-cbc";

// Define types for encryption and decryption functions
interface EncryptResult {
    iv: Buffer;
    encrypted: Buffer;
};

function generateIv(): Buffer {
    return crypto.randomBytes(16);
}

// These should be populated with environmental variables or a key store in production
const secretKey: Buffer = Buffer.from('6245cb9b8dab1c1630bb3283063f963574d612ca6ec60bc8a5d1e07ddd3f7c53', 'hex');

const app = express();
const port = 8080;

app.use(express.static("./public"));
app.use(bodyParser.json());

const storage = multer.memoryStorage();
const upload = multer({ storage });

function encrypt(algorithm: string, buffer: Buffer, key: Buffer, iv: Buffer): EncryptResult {
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return { iv, encrypted };
}

function decrypt(algorithm: string, buffer: Buffer, key: Buffer, iv: Buffer): Buffer {
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    const decrypted = Buffer.concat([decipher.update(buffer), decipher.final()]);
    return decrypted;
}

function getEncryptedFilePath(filePath: string): string {
    return path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)) + path.extname(filePath));
}

async function saveEncryptedFile(buffer: Buffer, filePath: string, key: Buffer): Promise<void> {
    const iv = generateIv();
    const { encrypted } = encrypt(CryptoAlgorithm, buffer, key, iv);

    const encryptedFilePath = getEncryptedFilePath(filePath);
    await fs.promises.mkdir(path.dirname(encryptedFilePath), { recursive: true });

    // Save both the IV and the encrypted file
    const ivAndEncrypted = Buffer.concat([iv, encrypted]);
    await fs.promises.writeFile(encryptedFilePath, ivAndEncrypted);
}

async function getEncryptedFile(filePath: string, key: Buffer): Promise<Buffer> {
    try {
        const encryptedFilePath = getEncryptedFilePath(filePath);
        if (!fs.existsSync(encryptedFilePath)) {
            throw new Error("File not found");
        }

        const ivAndEncrypted = await fs.promises.readFile(encryptedFilePath);

        const iv = ivAndEncrypted.slice(0, 16);
        const encrypted = ivAndEncrypted.slice(16);

        const buffer = decrypt(CryptoAlgorithm, encrypted, key, iv);
        return buffer;
    } catch (error) {
        console.error("Error in getEncryptedFile:", (error as Error).message);
        throw error;
    }
}

app.post("/upload", upload.single("file"), async (req: Request, res: Response, next: NextFunction) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ status: "error", message: "No file uploaded" });
        }
        
        console.log("File upload: ", file.originalname);
        await saveEncryptedFile(file.buffer, path.join("./uploads", file.originalname), secretKey);
        res.status(201).json({ status: "ok" });
    } catch (error) {
        console.error("Upload error:", (error as Error).message);
        res.status(500).json({ status: "error", message: "File upload failed" });
    }
});

app.get("/file/:fileName", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const fileName = req.params.fileName;
        console.log("Getting file:", fileName);
        const buffer = await getEncryptedFile(path.join("./uploads", fileName), secretKey);
        console.log("11111111111: ", buffer)
        
        const readStream = new PassThrough();
        readStream.end(buffer);
        
        res.writeHead(200, {
            "Content-disposition": `attachment; filename=${fileName}`,
            "Content-Type": "application/octet-stream",
            "Content-Length": buffer.length
        });
        readStream.pipe(res);
    } catch (error) {
        console.error("Download error:", (error as Error).message);
        res.status(500).json({ status: "error", message: "File download failed" });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
