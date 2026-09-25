/**
 * eslint-disable @typescript-eslint/no-explicit-any
 *
 * @format
 */

import httpStatus from "http-status";
import { Support, ISupport } from "../../models";
import { ApiError, isValidMongoObjectId, mongoFunctions } from "../../utils";
import {
	BodyDefinition,
	ParamsDefinition,
	QueryDefinition,
} from "../../types/RouteDefinition";
import { mongoOperationsTypes, ticketStatusTypes } from "../../configs/constantTypes";

export const createSupport = async (body: BodyDefinition): Promise<any> => {
	try {
		const { name, email, address, subject, message, mobile, user } = body;
		const supportObj = {
			name,
			email,
			subject,
			user_id: user._id,
		};
		if (address && address !== "undefined") {
			supportObj["address"] = address;
		}
		if (message && message !== "undefined") {
			supportObj["message"] = message;
		}
		if (mobile && mobile !== "undefined") {
			supportObj["mobile"] = mobile;
		}
		const supportDoc = await mongoFunctions({
			schema: Support,
			createData: supportObj,
			operationType: mongoOperationsTypes.CREATE,
		});
		if (!supportDoc) {
			throw new ApiError(
				httpStatus.INTERNAL_SERVER_ERROR,
				"Failed to create new Support Request"
			);
		}
		return "";
	} catch (error) {
		throw new ApiError(
			error.statusCode ? error.statusCode : httpStatus.INTERNAL_SERVER_ERROR,
			error.message
		);
	}
};

export const getAllSupport = async (
	body: BodyDefinition,
	query: QueryDefinition
): Promise<ISupport[]> => {
	try {
		const { limit = 10, offset = 0 } = query;
		const { user } = body;

		const supportDocs = await Support.find({ user_id: user._id })
			.sort({ created_at: -1 })
			.limit(Number(limit))
			.skip(Number(offset));

		return supportDocs;
	} catch (error: any) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message ||
				"An unexpected error occurred while fetching support tickets."
		);
	}
};

export const deleteSupport = async (
	body: BodyDefinition,
	params: ParamsDefinition
): Promise<object> => {
	try {
		const { supportId } = params;
		const { user } = body;

		if (!isValidMongoObjectId(supportId)) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				"Invalid supportId provided: Please provide a valid Mongo ObjectId."
			);
		}

		const deletedSupport = await Support.findOneAndDelete({
			_id: supportId,
			user_id: user._id,
		});

		if (!deletedSupport) {
			throw new ApiError(
				httpStatus.NOT_FOUND,
				"Support ticket not found or already deleted."
			);
		}

		return { message: "Support ticket deleted successfully." };
	} catch (error: any) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message || "An unexpected error occurred while deleting support."
		);
	}
};

export const getAllSupportTicketsByAdmin = async (): Promise<ISupport[]> => {
	try {
		const supportDocs = await Support.find().sort({ created_at: -1 });

		return supportDocs;
	} catch (error: any) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message ||
				"An unexpected error occurred while fetching support tickets."
		);
	}
};

export const updateSupportTicketStatus = async (reqBody) => {
	try {
		const { ticket_id, status } = reqBody;

		// Validate fields
		if (!ticket_id || !status) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				"Please provide both 'ticket_id' and 'status'."
			);
		}

		// Validate allowed status values
		const validStatuses = Object.values(ticketStatusTypes);
		if (!validStatuses.includes(status)) {
			throw new ApiError(
				httpStatus.BAD_REQUEST,
				`Invalid status. Allowed values: ${validStatuses.join(", ")}.`
			);
		}

		// Find ticket
		const ticket = await Support.findById(ticket_id);
		if (!ticket) {
			throw new ApiError(httpStatus.NOT_FOUND, "Support ticket not found.");
		}

		// Update status
		ticket.status = status;
		await ticket.save();

		return {
			success: true,
			message: `Support ticket status updated to '${status}'.`,
			data: ticket,
		};
	} catch (error) {
		throw new ApiError(
			error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
			error.message ||
				"An unexpected error occurred while updating support ticket status."
		);
	}
};

export const getSupportTicketStatusCounts = async () => {
  try {
    const statusCounts = await Support.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Initialize counts for all statuses to 0
    const counts = {
      open: 0,
      in_progress: 0,
      resolved: 0,
      closed: 0,
    };

    // Map DB counts to the object
    statusCounts.forEach((item) => {
      counts[item._id] = item.count;
    });

    return counts;
  } catch (error) {
    throw new ApiError(
      error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      error.message ||
        "An unexpected error occurred while counting support ticket statuses."
    );
  }
};
