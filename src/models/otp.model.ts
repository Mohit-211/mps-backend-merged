import mongoose, { Document, Schema, Model } from 'mongoose';
import { otpTypes, otpTypesArr } from '../configs/constantTypes';
import { addTimestamps, globalQueryFilters, toJSON } from '../configs/mongoPlugins';

export interface IOTP extends Document {
  _id: mongoose.Types.ObjectId;
  email?: string;
  user_id?: Schema.Types.ObjectId;
  mobile?: string;
  code?: string;
  type: string;
  otp_expiration_time: Date;
  is_verified: boolean;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}

const otpSchema = new Schema<IOTP>(
  {
    email: {
      type: String,
      maxLength: 150,
      default: null,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    mobile: {
      type: String,
      maxLength: 50,
      default: null,
    },
    code: {
      type: String,
      maxLength: 50,
      default: null,
    },
    type: {
      type: String,
      enum: otpTypesArr,
      required: true,
      default: otpTypes.EMAIL_VERIFICATION,
    },
    otp_expiration_time: {
      type: Date,
      required: true,
    },
    is_verified: {
      type: Boolean,
      default: false,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
    updated_at: {
      type: Date,
      default: Date.now,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
    created_by: {
      type: Number,
      default: null,
    },
  },
  {
    collection: 'otps',
  }
);

otpSchema.plugin(globalQueryFilters)
otpSchema.plugin(toJSON)
otpSchema.plugin(addTimestamps);

otpSchema.pre('validate', function (next) {
  const expirationTime = new Date();
  expirationTime.setMinutes(expirationTime.getMinutes() + 5);
  this.otp_expiration_time = expirationTime;
  next();
});

export const OTP: Model<IOTP> = mongoose.model<IOTP>('OTP', otpSchema);
