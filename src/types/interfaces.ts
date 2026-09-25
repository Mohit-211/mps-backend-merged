export interface AccessToken {
	id: string;
	token: string;
	expires: Date;
}

export interface RefreshToken {
	id: string;
	token: string;
	expires: Date;
}

export interface TokenDefination {
	access: AccessToken;
	refresh: RefreshToken;
}

export interface UploadedFile {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    destination: string;
    filename: string;
    path: string;
    buffer: Buffer;
}

export interface MonthData {
	label: string;
	startDate: string;
	endDate: string;
}

export interface MonthlyData {
	label: string;
	avg: string;
	google: any[];
	'google-mobile': any[];
}