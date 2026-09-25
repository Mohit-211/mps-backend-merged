/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import logger from './logger';
import('./mongoConnection');

import {
	City,
	Country,
	Language,
	Profile,
	Role,
	State,
	Timezone,
	User,
	BusinessCategory,
} from '../models';
import config from './config';
import { userStatusTypes } from './constantTypes';

const DUMP_DIR = path.resolve(__dirname, '../../dumps');

class DataSeeder {
	roleDataPath: string;
	countryDataPath: string;
	timezoneDataPath: string;
	languagesDataPath: string;
	stateDataPath: string;
	cityDataPath: string;
	businessCategoryDataPath: string;
	constructor() {
		this.roleDataPath = path.resolve(DUMP_DIR, 'roles.json');
		this.countryDataPath = path.resolve(DUMP_DIR, 'countries.json');
		this.timezoneDataPath = path.resolve(DUMP_DIR, 'timezones.json');
		this.languagesDataPath = path.resolve(DUMP_DIR, 'languages.json');
		this.stateDataPath = path.resolve(DUMP_DIR, 'states.json');
		this.cityDataPath = path.resolve(DUMP_DIR, 'cities.json');
		this.businessCategoryDataPath = path.resolve(DUMP_DIR, 'businessCategory.json');
	}

	async seedBusinessCategory() {
		try {
			const jsonBusinessCategoryData = JSON.parse(
				fs.readFileSync(this.businessCategoryDataPath, 'utf-8'),
			);
			await BusinessCategory.insertMany(jsonBusinessCategoryData);
			logger.info('BusinessCategory Data inserted successfully');
		} catch (err) {
			logger.error('Error inserting BusinessCategory data: ', err);
			throw err;
		}
	}

	async seedRoles() {
		try {
			const jsonRoleData = JSON.parse(
				fs.readFileSync(this.roleDataPath, 'utf-8'),
			);
			await Role.insertMany(jsonRoleData);
			logger.info('Role Data inserted successfully');
		} catch (err) {
			logger.error('Error inserting Role data: ', err);
			throw err;
		}
	}

	async seedCountries() {
		try {
			const jsonCountryData = JSON.parse(
				fs.readFileSync(this.countryDataPath, 'utf-8'),
			);
			await Country.insertMany(jsonCountryData);
			logger.info('Country Data inserted successfully');
		} catch (err) {
			logger.error('Error inserting Country data: ', err);
			throw err;
		}
	}

	async seedTimezones() {
		try {
			const jsonTimezoneData = JSON.parse(
				fs.readFileSync(this.timezoneDataPath, 'utf-8'),
			);
			await Timezone.insertMany(jsonTimezoneData);
			logger.info('Timezone Data inserted successfully');
		} catch (err) {
			logger.error('Error inserting Timezone data: ', err);
			throw err;
		}
	}

	async seedLanguages() {
		try {
			const jsonLanguageData = JSON.parse(
				fs.readFileSync(this.languagesDataPath, 'utf-8'),
			);
			await Language.insertMany(jsonLanguageData);
			logger.info('Language Data inserted successfully');
		} catch (err) {
			logger.error('Error inserting Language data: ', err);
			throw err;
		}
	}

	async seedStates() {
		try {
			const jsonStateData = JSON.parse(
				fs.readFileSync(this.stateDataPath, 'utf-8'),
			);
			const stateData = await this.processStateData(jsonStateData);
			await State.insertMany(stateData);
			logger.info('State Data inserted successfully');
		} catch (err) {
			logger.error('Error inserting State data: ', err);
			throw err;
		}
	}

	async processStateData(jsonStateData: any) {
		const temp = [];
		for (const state of jsonStateData) {
			const countryDoc = await Country.findOne({
				iso3: state.country_code,
			});
			if (countryDoc) {
				state.country_id = countryDoc._id;
				temp.push(state);
			} else {
				continue;
			}
		}
		return temp;
	}

	async seedCities() {
		try {
			const jsonCityData = JSON.parse(
				fs.readFileSync(this.cityDataPath, 'utf-8'),
			);
			const cityData = await this.processCityData(jsonCityData);
			await City.insertMany(cityData);
			logger.info('City Data inserted successfully');
		} catch (err) {
			logger.error('Error inserting City data: ', err);
			throw err;
		}
	}

	async processCityData(combinedCityData: any) {
		const temp = [];
		for (const city of combinedCityData) {
			const countryDoc = await Country.findOne({
				iso3: city.country_code,
			});
			const stateDoc = await State.findOne({ state_code: city.state_code, country_code: city.country_code });

			if (stateDoc && countryDoc) {
				city.state_id = stateDoc._id;
				city.country_id = countryDoc._id;
				temp.push(city);
			} else {
				continue;
			}
		}
		return temp;
	}

	async createSuperAdmin() {
		try {
			const salt = bcrypt.genSaltSync(10);
			const adminObj = {
				email: config.superAdmin.email,
				password: bcrypt.hashSync(config.superAdmin.password, salt),
				role_id: config.roles.superAdmin,
				status: userStatusTypes.ACCEPTED,
			};

			let adminDoc = await User.findOne({
				email: config.superAdmin.email,
			});
			if (!adminDoc) {
				adminDoc = await User.create(adminObj);

				const profileObj = {
					user_id: adminDoc._id,
					name: config.superAdmin.email,
				};
				await Profile.create(profileObj);
			}
			logger.info(
				`Super Admin data inserted successfully: email: ${config.superAdmin.email} and password : ${config.superAdmin.password}`,
			);
		} catch (error) {
			logger.error('Error inserting Super Admin data: ', error);
			throw error;
		}
	}



	async seedAll() {
		try {
			await this.seedBusinessCategory();
			await this.seedRoles();
			await this.seedCountries();
			await this.seedTimezones();
			await this.seedLanguages();
			await this.seedStates();
			await this.seedCities();
			await this.createSuperAdmin();
			process.exit(0);
		} catch (error) {
			logger.error('Error seeding data: ', error);
			process.exit(1);
		}
	}
}

// Usage
const dataSeeder = new DataSeeder();
dataSeeder.seedAll();
