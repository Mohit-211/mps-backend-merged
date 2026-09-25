/* eslint-disable @typescript-eslint/no-explicit-any */

import httpStatus from 'http-status';
import { ContactUs } from '../../models';
import { ApiError, mongoFunctions } from '../../utils';
import { mongoOperationsTypes } from '../../configs/constantTypes';
import {
	sendContactUsAdminMail,
	sendContactUsConfirmationMail,
} from './email.service';

interface CreateContactRequest {
	full_name: string;
	business_name: string;
	email: string;
	phone_number?: string;
	business_website?: string;
	business_location?: string;
	company_size: string;
	primary_interest: string;
	goals_or_challenges: string;
}

export const createContactUs = async (reqBody: any): Promise<any> => {
	try {
		const contactObj: CreateContactRequest = {
			full_name: reqBody.full_name,
			business_name: reqBody.business_name,
			email: reqBody.email,
			phone_number: reqBody.phone_number,
			business_website: reqBody.business_website,
			business_location: reqBody.business_location,
			company_size: reqBody.company_size,
			primary_interest: reqBody.primary_interest,
			goals_or_challenges: reqBody.goals_or_challenges,
		};

		const contactDoc = await mongoFunctions({
			schema: ContactUs,
			createData: contactObj,
			operationType: mongoOperationsTypes.CREATE,
		});

		if (!contactDoc) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				'Failed to submit contact request',
			);
		}

		await sendContactUsConfirmationMail(
			contactObj.email,
			contactObj.full_name,
		);

		await sendContactUsAdminMail(
			contactObj.full_name,
			contactObj.business_name,
			contactObj.email,
			contactObj.phone_number,
			contactObj.business_website,
			contactObj.business_location,
			contactObj.company_size,
			contactObj.primary_interest,
			contactObj.goals_or_challenges,
		);

		return '';
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getAllContactUs = async (queryParams: any): Promise<any> => {
	try {
		const page = Number(queryParams.page) || 1;
		const limit = Number(queryParams.limit) || 10;

		const offset = (page - 1) * limit;

		const search = queryParams.search || '';
		const status = queryParams.status || '';

		const filter: any = {
			is_active: true,
		};

		if (status) {
			filter.status = status;
		}

		if (search) {
			filter.$or = [
				{
					full_name: {
						$regex: search,
						$options: 'i',
					},
				},
				{
					business_name: {
						$regex: search,
						$options: 'i',
					},
				},
				{
					email: {
						$regex: search,
						$options: 'i',
					},
				},
			];
		}

		const totalResults = await ContactUs.countDocuments(filter);

		const results = await ContactUs.getAll(limit, offset, search, status);

		return {
			results,
			page,
			limit,
			totalPages: Math.ceil(totalResults / limit),
			totalResults,
		};
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const getContactUsById = async (contactId: string): Promise<any> => {
	try {
		const contact = await ContactUs.getById(contactId);

		if (!contact) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				'Contact request not found',
			);
		}

		return contact;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const updateContactUsStatus = async (
	contactId: string,
	reqBody: any,
): Promise<any> => {
	try {
		const { status } = reqBody;

		const allowedStatus = ['NEW', 'IN_PROGRESS', 'CONTACTED', 'CLOSED'];

		if (!allowedStatus.includes(status)) {
			throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status.');
		}

		const contact = await ContactUs.updateStatusById(contactId, status);

		if (!contact) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				'Contact request not found',
			);
		}

		return contact;
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};

export const deleteContactUs = async (contactId: string): Promise<any> => {
	try {
		await ContactUs.deleteById(contactId);

		return '';
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};
