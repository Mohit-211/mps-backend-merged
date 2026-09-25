import { responseWrapper, catchAsync } from '../../utils';
import { languageService } from '../../services';

export const getAllLanguage = catchAsync(async (req, res) => {
    const result = await languageService.getAllLanguage(req.query);
    return responseWrapper(res, result);
});