/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from 'http-status';

import { ApiError } from '../../utils';
import { BodyDefinition, ParamsDefinition } from '../../types/RouteDefinition';
import { fetchAllReviews, formatDate } from '../../helpers';


export const getMonitorReviewReport = async (body: BodyDefinition): Promise<any> => {
	try {
		const { locationDoc } = body;
        if(!locationDoc.place_id){
            throw new ApiError(
                httpStatus.BAD_REQUEST,
                'Please Register Your Business at Google Business Profile Console',
              );
        }
        const placeDetails: any = await fetchAllReviews(locationDoc.place_id);
        // return placeDetails
        // let placeDetails = {
        //     "placeInfo": {
        //         "title": "BlockCod Technologies Private Limited",
        //         "address": "B-1592, First Floor, Shastri Nagar, New Delhi, Delhi 110052, India",
        //         "rating": 4.9,
        //         "reviews": 13,
        //         "type": "Computer support and services"
        //     },
        //     "reviews": [
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChdDSUhNMG9nS0VJQ0FnSUNOcF8zTWpBRRAB!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgICNp_3MjAE%7CCgsIjIqlrQYQ0K3vKw%7C?hl=en-US",
        //             "rating": 5,
        //             "date": "7 months ago",
        //             "iso_date": "2024-01-18T15:34:36Z",
        //             "iso_date_of_last_edit": "2024-01-18T15:34:36Z",
        //             "source": "Google",
        //             "review_id": "ChdDSUhNMG9nS0VJQ0FnSUNOcF8zTWpBRRAB",
        //             "user": {
        //                 "name": "Denise Sottile",
        //                 "link": "https://www.google.com/maps/contrib/109238857567992262806?hl=en-US",
        //                 "contributor_id": "109238857567992262806",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a-/ALV-UjUv14F2XfmP32I0CBoxKOEqEcVOawZdlZcfsPccXini53V67ken=s120-c-rp-mo-br100",
        //                 "reviews": 5,
        //                 "photos": 0
        //             },
        //             "snippet": "Very easy to work with Mohit, honest, high integrity, very responsive, goes over and above in helping the client work through the process.  I highly recommend their services and I personally will use them again in the future.  It was an absolutely pleasure working with them.",
        //             "extracted_snippet": {
        //                 "original": "Very easy to work with Mohit, honest, high integrity, very responsive, goes over and above in helping the client work through the process.  I highly recommend their services and I personally will use them again in the future.  It was an absolutely pleasure working with them."
        //             },
        //             "likes": 0,
        //             "formatted_date": "18th Jan 2024"
        //         },
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSUNOOF9YUVZREAE!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgICN8_XQVQ%7CCgwIkNOgrQYQqPKNzwM%7C?hl=en-US",
        //             "rating": 4,
        //             "date": "7 months ago",
        //             "iso_date": "2024-01-17T19:25:04Z",
        //             "iso_date_of_last_edit": "2024-01-17T19:25:04Z",
        //             "source": "Google",
        //             "review_id": "ChZDSUhNMG9nS0VJQ0FnSUNOOF9YUVZREAE",
        //             "user": {
        //                 "name": "Cedrick LaFleur",
        //                 "link": "https://www.google.com/maps/contrib/110953491193026221155?hl=en-US",
        //                 "contributor_id": "110953491193026221155",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a-/ALV-UjUUxZ0-0qc_FUA3gS5CUSiKF748nukySRAlWiu02ZrChYJyK5OqNg=s120-c-rp-mo-br100",
        //                 "local_guide": true,
        //                 "reviews": 5,
        //                 "photos": 0
        //             },
        //             "snippet": "Mohit and team built 2 websites for me over a 3 month timeframe. I’m very pleased with the final product. Along the way, Mohit was willing and able to meet with me to update and make adjustments when and where needed.\n\nThe feedback we have received from our sites has been very positive.",
        //             "extracted_snippet": {
        //                 "original": "Mohit and team built 2 websites for me over a 3 month timeframe. I’m very pleased with the final product. Along the way, Mohit was willing and able to meet with me to update and make adjustments when and where needed.\n\nThe feedback we have received from our sites has been very positive."
        //             },
        //             "likes": 0,
        //             "formatted_date": "17th Jan 2024"
        //         },
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSURKNTRtN0hREAE!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgIDJ54m7HQ%7CCgwI5Nr5pQYQkNDCxQI%7C?hl=en-US",
        //             "rating": 5,
        //             "date": "a year ago",
        //             "iso_date": "2023-07-24T12:24:04Z",
        //             "iso_date_of_last_edit": "2023-07-24T12:24:04Z",
        //             "source": "Google",
        //             "review_id": "ChZDSUhNMG9nS0VJQ0FnSURKNTRtN0hREAE",
        //             "user": {
        //                 "name": "Santosh Yadav",
        //                 "link": "https://www.google.com/maps/contrib/110875194260007268517?hl=en-US",
        //                 "contributor_id": "110875194260007268517",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a-/ALV-UjXcHnAwK6R9S5JcNlori3FhQakUKNJbPwCzsPNAfq7Vcjqgfa5X=s120-c-rp-mo-br100",
        //                 "local_guide": true,
        //                 "reviews": 3,
        //                 "photos": 8
        //             },
        //             "likes": 0,
        //             "formatted_date": "24th Jul 2023"
        //         },
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSUN4cTdfa0VnEAE!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgICxq7_kEg%7CCgwI77zCowYQuLbB0wE%7C?hl=en-US",
        //             "rating": 5,
        //             "date": "a year ago",
        //             "iso_date": "2023-05-26T11:56:31Z",
        //             "iso_date_of_last_edit": "2023-05-26T11:56:31Z",
        //             "source": "Google",
        //             "review_id": "ChZDSUhNMG9nS0VJQ0FnSUN4cTdfa0VnEAE",
        //             "user": {
        //                 "name": "Prerna Rastogi",
        //                 "link": "https://www.google.com/maps/contrib/113123129629311340753?hl=en-US",
        //                 "contributor_id": "113123129629311340753",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a-/ALV-UjXLH1Dp0VdcMeTpovepkb5nu9u6pHNhhnwaUjvfsltCeDbSZ2ek=s120-c-rp-mo-br100",
        //                 "reviews": 4,
        //                 "photos": 0
        //             },
        //             "snippet": "Good work place",
        //             "extracted_snippet": {
        //                 "original": "Good work place"
        //             },
        //             "likes": 0,
        //             "formatted_date": "26th May 2023"
        //         },
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSUN4cS1uSmRBEAE!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgICxq-nJdA%7CCgsIupTCowYQqMqGQw%7C?hl=en-US",
        //             "rating": 5,
        //             "date": "a year ago",
        //             "iso_date": "2023-05-26T10:30:18Z",
        //             "iso_date_of_last_edit": "2023-05-26T10:30:18Z",
        //             "images": [
        //                 "https://lh5.googleusercontent.com/p/AF1QipMPVfuC1UbYb0b8xZZxKq-GtdYFWSd7Xsc0EPOo=w150-h150-k-no-p"
        //             ],
        //             "source": "Google",
        //             "review_id": "ChZDSUhNMG9nS0VJQ0FnSUN4cS1uSmRBEAE",
        //             "user": {
        //                 "name": "Rakesh Kumar Sharma",
        //                 "link": "https://www.google.com/maps/contrib/109962618971735967956?hl=en-US",
        //                 "contributor_id": "109962618971735967956",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a-/ALV-UjWqWX_iCyy5-6TpbuJxnSV0CUrjss8pC9U8B3cMub9pnJSDhhNN=s120-c-rp-mo-br100",
        //                 "local_guide": true,
        //                 "reviews": 9,
        //                 "photos": 2
        //             },
        //             "snippet": "Blockcod is a pioneering startup company that has emerged as a frontrunner in providing comprehensive IT software services. In this review, we will explore the key strengths and features of blockcod company that make it a reliable choice for transforming businesses.",
        //             "extracted_snippet": {
        //                 "original": "Blockcod is a pioneering startup company that has emerged as a frontrunner in providing comprehensive IT software services. In this review, we will explore the key strengths and features of blockcod company that make it a reliable choice for transforming businesses."
        //             },
        //             "likes": 1,
        //             "formatted_date": "26th May 2023"
        //         },
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSUN4cTZIYk1nEAE!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgICxq6HbMg%7CCgsI9IzCowYQ6NSDLg%7C?hl=en-US",
        //             "rating": 5,
        //             "date": "a year ago",
        //             "iso_date": "2023-05-26T10:14:12Z",
        //             "iso_date_of_last_edit": "2023-05-26T10:14:12Z",
        //             "source": "Google",
        //             "review_id": "ChZDSUhNMG9nS0VJQ0FnSUN4cTZIYk1nEAE",
        //             "user": {
        //                 "name": "Aamir Iqbal",
        //                 "link": "https://www.google.com/maps/contrib/113158747834454694075?hl=en-US",
        //                 "contributor_id": "113158747834454694075",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a-/ALV-UjUv4pAIkgTltRPP_z2_69lr6Gp8do4hYzcLHBfUCFGtlGMhEFjj=s120-c-rp-mo-ba3-br100",
        //                 "local_guide": true,
        //                 "reviews": 13,
        //                 "photos": 52
        //             },
        //             "snippet": "Great Place",
        //             "extracted_snippet": {
        //                 "original": "Great Place"
        //             },
        //             "likes": 0,
        //             "formatted_date": "26th May 2023"
        //         },
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSUN4cTZHVkx3EAE!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgICxq6GVLw%7CCgwI5ozCowYQqOjcmgM%7C?hl=en-US",
        //             "rating": 5,
        //             "date": "a year ago",
        //             "iso_date": "2023-05-26T10:13:58Z",
        //             "iso_date_of_last_edit": "2023-05-26T10:13:58Z",
        //             "source": "Google",
        //             "review_id": "ChZDSUhNMG9nS0VJQ0FnSUN4cTZHVkx3EAE",
        //             "user": {
        //                 "name": "Asim feroz",
        //                 "link": "https://www.google.com/maps/contrib/108266141155578049528?hl=en-US",
        //                 "contributor_id": "108266141155578049528",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a/ACg8ocIPs6T2UhQZDBCiI1FebLqUPvrKNedMeuaTTNugJ2486mLJCA=s120-c-rp-mo-br100",
        //                 "reviews": 0,
        //                 "photos": 0
        //             },
        //             "likes": 0,
        //             "formatted_date": "26th May 2023"
        //         },
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSUN4cTZIc0x3EAE!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgICxq6HsLw%7CCgsIpIzCowYQ0JCSaQ%7C?hl=en-US",
        //             "rating": 5,
        //             "date": "a year ago",
        //             "iso_date": "2023-05-26T10:12:52Z",
        //             "iso_date_of_last_edit": "2023-05-26T10:12:52Z",
        //             "source": "Google",
        //             "review_id": "ChZDSUhNMG9nS0VJQ0FnSUN4cTZIc0x3EAE",
        //             "user": {
        //                 "name": "Bhavya Soni",
        //                 "link": "https://www.google.com/maps/contrib/117175532668117352413?hl=en-US",
        //                 "contributor_id": "117175532668117352413",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a-/ALV-UjXFowyGTxyGLjqT1hCft9plzw7d2GLG3bMoj4y2y4w-isNzXs0=s120-c-rp-mo-br100",
        //                 "reviews": 1,
        //                 "photos": 0
        //             },
        //             "snippet": "Good environment with a lot of learning opportunities .",
        //             "extracted_snippet": {
        //                 "original": "Good environment with a lot of learning opportunities ."
        //             },
        //             "likes": 0,
        //             "formatted_date": "26th May 2023"
        //         },
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChdDSUhNMG9nS0VJQ0FnSUN4cTRIWjNBRRAB!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgICxq4HZ3AE%7CCgsI8YrCowYQsJ-eUg%7C?hl=en",
        //             "rating": 5,
        //             "date": "a year ago",
        //             "iso_date": "2023-05-26T10:09:53Z",
        //             "iso_date_of_last_edit": "2023-05-26T10:09:53Z",
        //             "source": "Google",
        //             "review_id": "ChdDSUhNMG9nS0VJQ0FnSUN4cTRIWjNBRRAB",
        //             "user": {
        //                 "name": "Anil Saini",
        //                 "link": "https://www.google.com/maps/contrib/114740028204249272676?hl=en",
        //                 "contributor_id": "114740028204249272676",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a/ACg8ocLhMxgMofM8K7cm59UYLhyWSo7N6MYPuBqI0hJ0aQYbQCXOcA=s120-c-rp-mo-br100",
        //                 "reviews": 2,
        //                 "photos": 0
        //             },
        //             "snippet": "Amazing team !",
        //             "extracted_snippet": {
        //                 "original": "Amazing team !"
        //             },
        //             "likes": 0,
        //             "formatted_date": "26th May 2023"
        //         },
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChdDSUhNMG9nS0VJQ0FnSUN4cV82Y2hRRRAB!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgICxq_6chQE%7CCgwIxonCowYQ6OrvxAM%7C?hl=en",
        //             "rating": 5,
        //             "date": "a year ago",
        //             "iso_date": "2023-05-26T10:07:02Z",
        //             "iso_date_of_last_edit": "2023-05-26T10:07:02Z",
        //             "source": "Google",
        //             "review_id": "ChdDSUhNMG9nS0VJQ0FnSUN4cV82Y2hRRRAB",
        //             "user": {
        //                 "name": "Sayyed Sohel",
        //                 "link": "https://www.google.com/maps/contrib/104675439994644189305?hl=en",
        //                 "contributor_id": "104675439994644189305",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a-/ALV-UjVb0UcUBG48qMqYZUNFsFaX2HzSMbAbBRM-Vn11UiO2WIygeBPa=s120-c-rp-mo-br100",
        //                 "reviews": 1,
        //                 "photos": 0
        //             },
        //             "likes": 0,
        //             "formatted_date": "26th May 2023"
        //         },
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSUN4cTc3bkVBEAE!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgICxq77nEA%7CCgwInYnCowYQ6Kv99gE%7C?hl=en",
        //             "rating": 5,
        //             "date": "a year ago",
        //             "iso_date": "2023-05-26T10:06:21Z",
        //             "iso_date_of_last_edit": "2023-05-26T10:06:21Z",
        //             "source": "Google",
        //             "review_id": "ChZDSUhNMG9nS0VJQ0FnSUN4cTc3bkVBEAE",
        //             "user": {
        //                 "name": "aishwariya tiwari",
        //                 "link": "https://www.google.com/maps/contrib/108751285520976458609?hl=en",
        //                 "contributor_id": "108751285520976458609",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a/ACg8ocIEhZmFOLXPdchO3EqVrrJ8EzInDXYPXyLVqQFLhjRyxTT0QQ=s120-c-rp-mo-br100",
        //                 "reviews": 3,
        //                 "photos": 0
        //             },
        //             "likes": 0,
        //             "formatted_date": "26th May 2023"
        //         },
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSUN4czY2aEF3EAE!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgICxs66hAw%7CCgsIwPW9owYQuIiDVA%7C?hl=en",
        //             "rating": 5,
        //             "date": "a year ago",
        //             "iso_date": "2023-05-25T15:12:00Z",
        //             "iso_date_of_last_edit": "2023-05-25T15:12:00Z",
        //             "source": "Google",
        //             "review_id": "ChZDSUhNMG9nS0VJQ0FnSUN4czY2aEF3EAE",
        //             "user": {
        //                 "name": "shrey sankrit",
        //                 "link": "https://www.google.com/maps/contrib/111258333509605216853?hl=en",
        //                 "contributor_id": "111258333509605216853",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a/ACg8ocLKNMr8E3GZW-GtDUQUfpsSNP3MCL4IQYrRAb5bIeCf9VAnbHU=s120-c-rp-mo-br100",
        //                 "reviews": 2,
        //                 "photos": 0
        //             },
        //             "likes": 0,
        //             "formatted_date": "25th May 2023"
        //         },
        //         {
        //             "link": "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChZDSUhNMG9nS0VJQ0FnSUN4MDczYVZ3EAE!2m1!1s0x0:0xa7a95c8dadc8c7eb!3m1!1s2@1:CIHM0ogKEICAgICx073aVw%7CCgsIzLS9owYQ8PTMTg%7C?hl=en",
        //             "rating": 5,
        //             "date": "a year ago",
        //             "iso_date": "2023-05-25T12:53:32Z",
        //             "iso_date_of_last_edit": "2023-05-25T12:53:32Z",
        //             "source": "Google",
        //             "review_id": "ChZDSUhNMG9nS0VJQ0FnSUN4MDczYVZ3EAE",
        //             "user": {
        //                 "name": "Hardaman Singh",
        //                 "link": "https://www.google.com/maps/contrib/106801177574022249737?hl=en",
        //                 "contributor_id": "106801177574022249737",
        //                 "thumbnail": "https://lh3.googleusercontent.com/a-/ALV-UjUpH-VFEJ_U7A60NX4VK2Z5zC_ZrtPqZpmdcSqWPGet3VaarPgC=s120-c-rp-mo-br100",
        //                 "reviews": 1,
        //                 "photos": 0
        //             },
        //             "likes": 0,
        //             "formatted_date": "25th May 2023"
        //         }
        //     ]
        // };

        if(!placeDetails || !placeDetails?.reviews ){
            throw new ApiError(
				httpStatus.BAD_REQUEST,
				'Failed to fetch all reviews data',
			);
        };
        const totalReviews = placeDetails.placeInfo.reviews || 0;
        const ratingCounts = {
            five: {count: 0, percentage: 0},
            four: {count: 0, percentage: 0},
            three: {count: 0, percentage: 0},
            two: {count: 0, percentage: 0},
            one: {count: 0, percentage: 0},
            no_rating: {count: 0, percentage: 0},
            recommended: {count: 0, percentage: 0},
            not_recommended: {count: 0, percentage: 0}
          };
          
          placeDetails.reviews = placeDetails.reviews.map((review: any) => {
            review.formatted_date = formatDate(review.iso_date);
            const rating = review.rating;
          
            if (rating === 5) {
              ratingCounts.five.count++;
              ratingCounts.recommended.count++;
            } else if (rating === 4) {
              ratingCounts.four.count++;
              ratingCounts.recommended.count++;
            } else if (rating === 3) {
              ratingCounts.three.count++;
            } else if (rating === 2) {
              ratingCounts.two.count++;
            } else if (rating === 1) {
              ratingCounts.one.count++;
              ratingCounts.not_recommended.count++;
            } else {
              ratingCounts.no_rating.count++;
            }
            return review;
          });

          ratingCounts.five.percentage = Math.round((ratingCounts.five.count / totalReviews) * 100);
          ratingCounts.four.percentage = Math.round((ratingCounts.four.count / totalReviews) * 100);
          ratingCounts.three.percentage = Math.round((ratingCounts.three.count / totalReviews) * 100);
          ratingCounts.two.percentage = Math.round((ratingCounts.two.count / totalReviews) * 100);
          ratingCounts.one.percentage = Math.round((ratingCounts.one.count / totalReviews) * 100);
          ratingCounts.recommended.percentage = Math.round((ratingCounts.recommended.count / totalReviews) * 100);
          ratingCounts.not_recommended.percentage = Math.round((ratingCounts.not_recommended.count / totalReviews) * 100);
          ratingCounts.no_rating.percentage = Math.round((ratingCounts.no_rating.count / totalReviews) * 100);
          
          placeDetails['rating_summary'] = ratingCounts;
          return placeDetails;
          
	} catch (error) {
		throw new ApiError(
			error.statusCode
				? error.statusCode
				: httpStatus.INTERNAL_SERVER_ERROR,
			error.message,
		);
	}
};