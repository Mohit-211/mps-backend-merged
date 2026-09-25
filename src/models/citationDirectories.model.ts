import mongoose, { Document, Model, Schema } from 'mongoose';
import {
	addTimestamps,
	globalQueryFilters,
	toJSON,
} from '../configs/mongoPlugins';

export interface ICitationDirectory extends Document {
	_id: mongoose.Types.ObjectId;
	name: string;
	url: string;
	domain: string;
	category: string;
	country: string;
	submission_type: string;
	aggregators?: string[];
	verification_required?: string[];
	citation_value: string;
	authority: number;
	is_active: boolean;
	created_at: Date;
	created_by?: Schema.Types.ObjectId;
	updated_at: Date;
	updated_by?: Schema.Types.ObjectId;
	deleted_at?: Date;
	deleted_by?: Schema.Types.ObjectId;
}
const citationDirectorySchema = new Schema<ICitationDirectory>(
	{
		name: {
			type: String,
			trim: true,
			required: true,
		},
		url: {
			type: String,
			trim: true,
			required: true,
		},
		domain: {
			type: String,
			trim: true,
			required: true,
		},
		category: {
			type: String,
			trim: true,
			required: true,
		},
		country: {
			type: String,
			trim: true,
			required: true,
		},
		submission_type: {
			type: String,
			trim: true,
			required: true,
		},
		aggregators: {
			type: [String],
			trim: true,
			default: []
		},
		verification_required: {
			type: [String],
			trim: true,
			default: []
		},
		citation_value: {
			type: String,
			trim: true,
			required: true,
		},
		authority: {
			type: Number,
			default: 0,
		},
		is_active: {
			type: Boolean,
			default: true,
		},
		created_at: {
			type: Date,
			default: Date.now,
		},
		created_by: {
			type: Schema.Types.ObjectId,
			default: null,
		},
		updated_at: {
			type: Date,
			default: Date.now,
		},
		updated_by: {
			type: Schema.Types.ObjectId,
			default: null,
		},
		deleted_at: {
			type: Date,
			default: null,
		},
		deleted_by: {
			type: Schema.Types.ObjectId,
			default: null,
		},
	},
	{
		collection: 'citationDirectorys',
	},
);

citationDirectorySchema.plugin(globalQueryFilters);
citationDirectorySchema.plugin(toJSON);
citationDirectorySchema.plugin(addTimestamps);


export const CitationDirectory: Model<ICitationDirectory> = mongoose.model<ICitationDirectory>(
	'CitationDirectory',
	citationDirectorySchema
);


let data = [
	{
		"name": "Google Business Profile",
		"url": "https://business.google.com/",
		"domain": "google.com",
		"category": "General",
		"country": "Global",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Postcard", "Phone", "Email", "Video"]
	},
	{
		"name": "Yelp",
		"url": "https://biz.yelp.com/",
		"domain": "yelp.com",
		"category": "General",
		"country": "Global",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "Bing Places",
		"url": "https://www.bingplaces.com/",
		"domain": "bingplaces.com",
		"category": "General",
		"country": "Global",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Postcard", "Phone", "Email"]
	},
	{
		"name": "Facebook Business",
		"url": "https://www.facebook.com/business/",
		"domain": "facebook.com",
		"category": "General",
		"country": "Global",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email", "Domain Verification", "Owner Docs"]
	},
	{
		"name": "YellowPages",
		"url": "https://www.yellowpages.com/",
		"domain": "yellowpages.com",
		"category": "General",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "aggregator",
		"aggregators": ["YP Network"],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "Foursquare",
		"url": "https://foursquare.com/",
		"domain": "foursquare.com",
		"category": "General",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "aggregator",
		"aggregators": ["Foursquare"],
		"verification_required": ["Email", "Phone"]
	},
	{
		"name": "Manta",
		"url": "https://www.manta.com/",
		"domain": "manta.com",
		"category": "General",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Email"]
	},
	{
		"name": "Angi (HomeAdvisor)",
		"url": "https://www.angi.com/",
		"domain": "angi.com",
		"category": "Niche",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "TripAdvisor",
		"url": "https://www.tripadvisor.com/",
		"domain": "tripadvisor.com",
		"category": "Niche",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Email", "Phone"]
	},
	{
		"name": "Better Business Bureau (BBB)",
		"url": "https://www.bbb.org/",
		"domain": "bbb.org",
		"category": "Niche",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Owner Docs", "Phone"]
	},
	{
		"name": "Hotfrog",
		"url": "https://www.hotfrog.com/",
		"domain": "hotfrog.com",
		"category": "General",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "aggregator",
		"aggregators": ["Data Axle"],
		"verification_required": ["Email"]
	},
	{
		"name": "Local.com",
		"url": "https://www.local.com/",
		"domain": "local.com",
		"category": "General",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Email", "Phone"]
	},
	{
		"name": "Cylex",
		"url": "https://www.cylex.us.com/",
		"domain": "cylex.us.com",
		"category": "General",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Email", "Phone"]
	},
	{
		"name": "Alignable",
		"url": "https://www.alignable.com/",
		"domain": "alignable.com",
		"category": "General",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "aggregator",
		"aggregators": ["Data Axle"],
		"verification_required": ["Email"]
	},
	{
		"name": "Glassdoor",
		"url": "https://www.glassdoor.com/",
		"domain": "glassdoor.com",
		"category": "Niche",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Email", "Owner Docs"]
	},
	{
		"name": "Yell",
		"url": "https://www.yell.com/",
		"domain": "yell.com",
		"category": "General",
		"country": "UK",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "Thomson Local",
		"url": "https://www.thomsonlocal.com/",
		"domain": "thomsonlocal.com",
		"category": "General",
		"country": "UK",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "Scoot",
		"url": "https://www.scoot.co.uk/",
		"domain": "scoot.co.uk",
		"category": "General",
		"country": "UK",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Email"]
	},
	{
		"name": "192.com",
		"url": "https://www.192.com/",
		"domain": "192.com",
		"category": "General",
		"country": "UK",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Email", "Owner Docs"]
	},
	{
		"name": "FreeIndex",
		"url": "https://www.freeindex.co.uk/",
		"domain": "freeindex.co.uk",
		"category": "General",
		"country": "UK",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "aggregator",
		"aggregators": ["YP Network"],
		"verification_required": ["Email"]
	},
	{
		"name": "Bizcommunity",
		"url": "https://www.bizcommunity.com/",
		"domain": "bizcommunity.com",
		"category": "Niche",
		"country": "UK",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "aggregator",
		"aggregators": ["Data Axle"],
		"verification_required": ["Email"]
	},
	{
		"name": "Checkatrade",
		"url": "https://www.checkatrade.com/",
		"domain": "checkatrade.com",
		"category": "Niche",
		"country": "UK",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Owner Docs"]
	},
	{
		"name": "Nichepilot",
		"url": "https://www.trustpilot.com/",
		"domain": "trustpilot.com",
		"category": "Niche",
		"country": "UK",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Email", "Owner Docs"]
	},
	{
		"name": "Netmums",
		"url": "https://www.netmums.com/",
		"domain": "netmums.com",
		"category": "Niche",
		"country": "UK",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Email"]
	},
	{
		"name": "Yelp UK",
		"url": "https://www.yelp.co.uk/",
		"domain": "yelp.co.uk",
		"category": "General",
		"country": "UK",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "Justdial",
		"url": "https://www.justdial.com/",
		"domain": "justdial.com",
		"category": "General",
		"country": "IN",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "OTP"]
	},
	{
		"name": "Sulekha",
		"url": "https://www.sulekha.com/",
		"domain": "sulekha.com",
		"category": "General",
		"country": "IN",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "IndiaMart",
		"url": "https://www.indiamart.com/",
		"domain": "indiamart.com",
		"category": "Niche",
		"country": "IN",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email", "Owner Docs"]
	},
	{
		"name": "TradeIndia",
		"url": "https://www.tradeindia.com/",
		"domain": "tradeindia.com",
		"category": "Niche",
		"country": "IN",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "Zomato",
		"url": "https://www.zomato.com/",
		"domain": "zomato.com",
		"category": "Niche",
		"country": "IN",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email", "Owner Docs"]
	},
	{
		"name": "Practo",
		"url": "https://www.practo.com/",
		"domain": "practo.com",
		"category": "Niche",
		"country": "IN",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Owner Docs"]
	},
	{
		"name": "UrbanClap (Urban Company)",
		"url": "https://www.urbancompany.com/",
		"domain": "urbancompany.com",
		"category": "Niche",
		"country": "IN",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "Justdial - Health",
		"url": "https://www.justdial.com/healthcare",
		"domain": "justdial.com",
		"category": "Niche",
		"country": "IN",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "OTP", "Owner Docs"]
	},
	{
		"name": "Sulekha - Services",
		"url": "https://www.sulekha.com/services",
		"domain": "sulekha.com",
		"category": "Niche",
		"country": "IN",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "YellowPages Canada",
		"url": "https://www.yellowpages.ca/",
		"domain": "yellowpages.ca",
		"category": "General",
		"country": "CA",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "aggregator",
		"aggregators": ["YP Network"],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "Canada411",
		"url": "https://www.canada411.ca/",
		"domain": "canada411.ca",
		"category": "General",
		"country": "CA",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone"]
	},
	{
		"name": "Yelp Canada",
		"url": "https://www.yelp.ca/",
		"domain": "yelp.ca",
		"category": "General",
		"country": "CA",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "Foursquare Canada",
		"url": "https://foursquare.com/",
		"domain": "foursquare.com",
		"category": "General",
		"country": "CA",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "aggregator",
		"aggregators": ["Foursquare"],
		"verification_required": ["Email", "Phone"]
	},
	{
		"name": "411.ca",
		"url": "https://www.411.ca/",
		"domain": "411.ca",
		"category": "General",
		"country": "CA",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "Canpages",
		"url": "https://www.canpages.ca/",
		"domain": "canpages.ca",
		"category": "General",
		"country": "CA",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "aggregator",
		"aggregators": ["Data Axle"],
		"verification_required": ["Phone", "Email"]
	},
	{
		"name": "Healthgrades",
		"url": "https://www.healthgrades.com/",
		"domain": "healthgrades.com",
		"category": "Niche",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Owner Docs", "Email", "Phone"]
	},
	{
		"name": "ZocDoc",
		"url": "https://www.zocdoc.com/",
		"domain": "zocdoc.com",
		"category": "Niche",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Owner Docs", "Email"]
	},
	{
		"name": "Avvo",
		"url": "https://www.avvo.com/",
		"domain": "avvo.com",
		"category": "Niche",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Owner Docs", "Email"]
	},
	{
		"name": "FindLaw",
		"url": "https://www.findlaw.com/",
		"domain": "findlaw.com",
		"category": "Niche",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Owner Docs", "Email"]
	},
	{
		"name": "RateMDs",
		"url": "https://www.ratemds.com/",
		"domain": "ratemds.com",
		"category": "Niche",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Email", "Phone", "Owner Docs"]
	},
	{
		"name": "Thumbtack",
		"url": "https://www.thumbtack.com/",
		"domain": "thumbtack.com",
		"category": "Niche",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Email", "Phone"]
	},
	{
		"name": "HomeAdvisor",
		"url": "https://www.homeadvisor.com/",
		"domain": "homeadvisor.com",
		"category": "Niche",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Phone", "Owner Docs"]
	},
	{
		"name": "TripAdvisor Restaurants",
		"url": "https://www.tripadvisor.com/Restaurants",
		"domain": "tripadvisor.com",
		"category": "Niche",
		"country": "US",
		"citation_value": "High",
		"authority": 99,
		"submission_type": "manual",
		"aggregators": [],
		"verification_required": ["Email", "Phone"]
	}
]



// data.map(async elm => {
// 	let obj = {
// 		"name": elm.name,
// 		"url": elm.url,
// 		"domain": elm.domain,
// 		"category": elm.category,
// 		"country": elm.country,
// 		submission_type: elm.submission_type,
// 		aggregators: elm?.aggregators,
// 		"verification_required": elm.verification_required,
// 		citation_value: elm.citation_value,
// 		authority: elm.authority,
// 	}
// 	await CitationDirectory.create(obj)
// })
