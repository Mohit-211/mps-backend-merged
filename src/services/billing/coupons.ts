import httpStatus from 'http-status';
import { Types } from 'mongoose';
import { Coupon, ICoupon } from '../../models';
import { apiErrorWithData } from '../../utils';

// Coupons on token packs (Phase 13a). A coupon is checked when an order is created and redeemed when it
// is captured (a coupon used up in between still honours the paid order).

const invalid = (reason: string, message: string) => apiErrorWithData(httpStatus.BAD_REQUEST, message, { reason });

export const findCouponForPack = async (code: string, packId: Types.ObjectId | string, now: Date = new Date()): Promise<ICoupon> => {
	const coupon = await Coupon.findOne({ code: String(code).trim().toUpperCase() }).lean<ICoupon>();
	if (!coupon || !coupon.is_active || coupon.value === undefined) throw invalid('invalid_coupon', 'This coupon code is not valid.');
	if (coupon.expires_at && coupon.expires_at <= now) throw invalid('coupon_expired', 'This coupon has expired.');
	if (coupon.max_redemptions !== null && coupon.max_redemptions !== undefined && coupon.redemptions >= coupon.max_redemptions) throw invalid('coupon_exhausted', 'This coupon has been used up.');
	if (coupon.pack_ids?.length && !coupon.pack_ids.some((p) => String(p) === String(packId))) throw invalid('coupon_not_applicable', 'This coupon does not apply to this pack.');
	return coupon;
};

export const redeemCoupon = async (couponId: Types.ObjectId | string): Promise<void> => {
	await Coupon.updateOne({ _id: couponId }, { $inc: { redemptions: 1 } });
};

export const couponView = (c: ICoupon) => ({
	id: String(c._id),
	code: c.code,
	discount_type: c.discount_type,
	value: c.value,
	pack_ids: (c.pack_ids ?? []).map(String),
	max_redemptions: c.max_redemptions,
	redemptions: c.redemptions,
	expires_at: c.expires_at,
	is_active: c.is_active,
	note: c.note,
});
