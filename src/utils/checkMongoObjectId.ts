import { Types } from 'mongoose';

const isValidMongoObjectId = (id: string): boolean => {
	if (Types.ObjectId.isValid(id)) {
		if (String(new Types.ObjectId(id)) === id) {
			return true;
		}
		return false;
	}
	return false;
};
export default isValidMongoObjectId;
