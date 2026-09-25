/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from 'http-status';
import { Faq, IFaq } from '../../models';
import { ApiError, isValidMongoObjectId, mongoFunctions } from '../../utils';
import { ParamsDefinition, QueryDefinition } from '../../types/RouteDefinition';
import { mongoOperationsTypes } from '../../configs/constantTypes';

interface CreateFaqRequest {
  question: string;
  answer: string;
}

export const createFaq = async (reqBody: any): Promise<any> => {
  try {
    const faqObj: CreateFaqRequest = {
      question: reqBody.question,
      answer: reqBody.answer,
    };
    
    const faqDoc = await mongoFunctions({
      schema: Faq,
      createData: faqObj,
      operationType: mongoOperationsTypes.CREATE,
    });
    if (!faqDoc) {
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create new FAQ');
    }
    return '';
  } catch (error) {
    throw new ApiError(error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR, error.message);
  }
};

export const getAllFaq = async (query: QueryDefinition): Promise<IFaq[]> => {
  try {
    const { limit, offset } = query;
    const faqDoc = await Faq.getAll(limit, offset)
    return faqDoc;
  } catch (error) {
    throw new ApiError(error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR, error.message);
  }
};

interface UpdateFaqRequest {
  question?: string;
  answer?: string;
}

export const updateFaq = async (body: UpdateFaqRequest, params: ParamsDefinition): Promise<any> => {
  try {
    const { faqId } = params;
    if (!isValidMongoObjectId(faqId)) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Invalid faqId provided: Need a valid mongo Object Id',
			);
		};
    await Faq.updateById(faqId, body);
    return '';
  } catch (error) {
    throw new ApiError(error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR, error.message);
  }
};

export const deleteFaq = async (params: ParamsDefinition): Promise<object> => {
  try {
    const { faqId } = params;
    if (!isValidMongoObjectId(faqId)) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Invalid faqId provided: Need a valid mongo Object Id',
			);
		};
    await Faq.deleteById(faqId);
    return {}
  } catch (error) {
    throw new ApiError(error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR, error.message);
  }
};