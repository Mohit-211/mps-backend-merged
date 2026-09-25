import mongoose, { Schema, Model, Document, Types } from 'mongoose';
import { addTimestamps, globalQueryFilters, toJSON } from '../configs/mongoPlugins';
import { gbpCallToAction, gbpCallToActionArr, gbpPostTopicType, gbpPostTopicTypeArr, postPublishStatus, postPublishStatusArr } from '../configs/constantTypes';


export interface IGBPPost extends Document {
    location_id?: Schema.Types.ObjectId
    gbpAccountId: string;
    gbpPostId?: string;
    gbpLocationId: string;
    languageCode: string;
    topicType: string;
    summary: string;
    schedule?: ISchedule | null;
    media?: {
        file_type?: string,
        file_name?: string,
        file_uri?: string,
        file_size?: string
    };
    callToAction?: {
        actionType: 'NONE' | 'BOOK' | 'ORDER_ONLINE' | 'LEARN_MORE' | 'BUY' | 'SIGN_UP' | 'CALL_NOW';
        url?: string;
    };
    event?: IEvent | null;
    offer?: IOffer | null;
    searchUrl?: string;
    status: string;
    is_posted: boolean;
    is_scheduled: boolean;
    is_active: boolean;
    created_at: Date;
    created_by?: Schema.Types.ObjectId;
    updated_at: Date;
    updated_by?: Schema.Types.ObjectId;
    deleted_at?: Date;
    deleted_by?: Schema.Types.ObjectId;
};
export interface IEvent {
    title: string;
    schedule: {
        startDate: {
            year: string,
            month: string,
            day: string
        },
        endDate: {
            year: string,
            month: string,
            day: string
        },
    }
}
export interface IOffer {
    couponCode?: string,
    redeemOnlineUrl?: string,
    termsConditions?: string
}
export interface ISchedule {
    timeZone: string;
    date: string;
    time: string;
}

const eventSchema = new Schema<IEvent>({
    title: {
        type: String,
        trim: true,
        required: true,
    },
    schedule: {
        startDate: {
            year: {
                type: String,
                required: true
            },
            month: {
                type: String,
                required: true
            },
            day: {
                type: String,
                required: true
            }
        },
        endDate: {
            year: {
                type: String,
                required: true
            },
            month: {
                type: String,
                required: true
            },
            day: {
                type: String,
                required: true
            }
        },
    }
});

const offerSchema = new Schema<IOffer>({
    couponCode: {
        type: String,
        trim: true,
        required: false,
        default: null
    },
    redeemOnlineUrl: {
        type: String,
        trim: true,
        required: false,
        default: null
    },
    termsConditions: {
        type: String,
        trim: true,
        required: false,
        default: null
    }
});

const scheduleSchema = new Schema<ISchedule>({
    timeZone: {
        type: String,
        required: true,
    },
    date: {
        type: String,
        required: true,
        match: /^\d{4}-\d{2}-\d{2}$/,
    },
    time: {
        type: String,
        required: true,
        validate: {
            validator: function (v: string) {
                return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
            },
            message: props => `${props.value} is not a valid time format (HH:mm)!`
        }
    }
});

const gbpPostSchema = new Schema<IGBPPost>(
    {
        location_id: {
            type: Types.ObjectId,
            ref: 'Location',
            required: true
        },
        gbpAccountId: {
            type: String,
            required: true
        },
        gbpPostId: {
            type: String,
            required: false,
            default: null
        },   
        searchUrl:{
            type: String,
            required: false,
            default: null
        },  
        gbpLocationId: {
            type: String,
            required: true
        },
        languageCode: {
            type: String,
            trim: true,
            default: 'en',
        },
        topicType: {
            type: String,
            enum: gbpPostTopicTypeArr,
            default: gbpPostTopicType.STANDARD,
            required: true
        },
        summary: {
            type: String,
            trim: true,
            required: true,
        },
        schedule: {
            type: scheduleSchema,
            required: false,
            default: null
        },
        media: {
            mediaFormat: {
                type: String,
                enum: ['PHOTO', 'VEDIO'],
                default: 'PHOTO',
            },
            sourceUrl: {
                type: String,
                trim: true,
                default: null,
                required: false,
            },
        },
        callToAction: {
            actionType: {
                type: String,
                enum: gbpCallToActionArr,
                required: true,
                default: gbpCallToAction.NONE
            },
            url: {
                type: String,
                validate: {
                    validator: function (v: string) {
                        return v ? /^(https?:\/\/)?[\w\-]+(\.[\w\-]+)+[/#?]?.*$/.test(v) : true;
                    },
                    message: props => `${props.value} is not a valid URL`
                },
                default: null,
                required: false,
            }
        },
        event: {
            type: eventSchema,
            required: false,
            default: null
        },
        offer: {
            type: offerSchema,
            required: false,
            default: null
        },
        status: {
            type: String,
            enum: postPublishStatusArr,
            default: postPublishStatus.live
        },
        is_active: {
            type: Boolean,
            default: true,
        },
        is_posted: {
            type: Boolean,
            default: true,
        },
        is_scheduled: {
            type: Boolean,
            default: false,
        },
        created_at: {
            type: Date,
            default: Date.now,
        },
        created_by: {
            type: Types.ObjectId,
            default: null,
        },
        updated_at: {
            type: Date,
            default: Date.now,
        },
        updated_by: {
            type: Types.ObjectId,
            default: null,
        },
        deleted_at: {
            type: Date,
            default: null,
        },
        deleted_by: {
            type: Types.ObjectId,
            default: null,
        },

    },
    {
        collection: 'gbpPosts'
    }
);

gbpPostSchema.plugin(globalQueryFilters);
gbpPostSchema.plugin(toJSON);
gbpPostSchema.plugin(addTimestamps);

interface IModelGBPPost extends Model<IGBPPost> {
};

export const GBPPost: IModelGBPPost = mongoose.model<IGBPPost, IModelGBPPost>(
    'GBPPost',
    gbpPostSchema
);