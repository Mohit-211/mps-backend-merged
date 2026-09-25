import { postPublishStatus } from '../configs/constantTypes';
import { agenda } from '../configs/mongoConnection';
import { GBPPost } from '../models';
import { publishPostToGBP } from '../services/common/gbpPostSchedular.service';

export const defineAgendaJobs = () => {
    agenda.define('post-to-gbp', { shouldSaveResult: true }, async (job) => {
        const { user, gbpPostData, gbpPostObj } = job.attrs.data;
        const result = await publishPostToGBP({ user, gbpPostData, gbpPostObj });
        if (result.status) {
            await GBPPost.updateOne(
                { _id: gbpPostObj.gbpPostID },
                {
                    $set: {
                        gbpPostId: result?.data?.name,
                        searchUrl: result?.data?.searchUrl,
                        is_posted: true,
                        is_scheduled: false,
                        status: postPublishStatus.live
                    }
                }
            )
        } else {
            await GBPPost.updateOne(
                { _id: gbpPostObj.gbpPostID },
                {
                    $set:
                    {
                        is_posted: false,
                        is_scheduled: false,
                        status: postPublishStatus.rejected
                    }
                }
            )
        }
        return result.status ? 'Success' : 'Failed';
    });

    // Define other jobs here...
};
