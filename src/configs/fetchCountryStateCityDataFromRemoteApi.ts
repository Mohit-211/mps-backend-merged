/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';
import { Country, State, City } from '../models';
import logger from './logger';
import './mongoConnection';
import { topCountries } from '../constants';

class DataInserter {
	private async fetchCountry(url: string): Promise<any[]> {
		try {
			const response = await axios.get(url);
			if (response.status >= 200 && response.status < 400) {
				return response.data.data;
			}
			throw new Error(`Failed to fetch Country from ${url}`);
		} catch (error: any) {
			if (error.response && error.response.status === 404) {
				throw new Error(`Resource not found at ${url}`);
			}
			throw new Error(
				`Failed to fetch data Country ${url}: ${error.message}`,
			);
		}
	}

	private async fetchState(url: string, body: object): Promise<any[]> {
		try {
			const response = await axios.post(url, body);
			if (response.status >= 200 && response.status < 400) {
				return response.data.data.states;
			}
			throw new Error(`Failed to fetch State from ${url}`);
		} catch (error: any) {
			if (error.response && error.response.status === 404) {
				throw new Error(`Resource not found at ${url}`);
			}
			throw new Error(
				`Failed to fetch State from ${url}: ${error.message}`,
			);
		}
	}

	private async delay(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	private async fetchCity(url: string, body: object, retries = 3): Promise<any[]> {
		for (let attempt = 1; attempt <= retries; attempt++) {
			try {
				const response = await axios.post(url, body);
				if (response.status >= 200 && response.status < 400) {
					return response.data.data;
				}
				throw new Error(`Failed to fetch City from ${url}`);
			} catch (error: any) {
				if (error.response && error.response.status === 404) {
					throw new Error(`Resource not found at ${url}`);
				}
				if (attempt < retries) {
					const delayTime = Math.pow(2, attempt) * 1000; // exponential backoff
					logger.warn(
						`Attempt ${attempt} failed: ${error.message}. Retrying in ${delayTime}ms...`,
					);
					await this.delay(delayTime);
				} else {
					throw new Error(
						`Failed to fetch City from ${url}: ${error.message}`,
					);
				}
			}
		}
		return []; // In case all retries fail, return an empty array
	}

	private getApiBaseUrl(type: string): string {
		const urls = {
			country:
				'https://countriesnow.space/api/v0.1/countries/info?returns=currency,flag,unicodeFlag,dialCode,iso2,iso3,capital,currency',
			state: 'https://countriesnow.space/api/v0.1/countries/states',
			city: 'https://countriesnow.space/api/v0.1/countries/state/cities',
		};
		return urls[type] || '';
	}

	public async insertCountryStateCity(): Promise<void> {
		try {
			const countries = await this.fetchCountry(
				this.getApiBaseUrl('country'),
			);

			// Process countries in batches
			const countryBatchSize = 10;
			for (let i = 0; i < countries.length; i += countryBatchSize) {
				const countriesBatch = countries.slice(i, i + countryBatchSize);
				await Promise.all(
					countriesBatch.map(async (country: any) => {
						try {
							if (topCountries.includes(country.name)) {
								const countryDoc = await Country.create({
									name: country.name,
									currency: country.currency,
									unicodeFlag: country.unicodeFlag,
									capital: country.capital,
									flag: country.flag,
									dialCode: country.dialCode,
									iso2: country.iso2,
									iso3: country.iso3,
								});

								const states = await this.fetchState(
									this.getApiBaseUrl('state'),
									{ country: country.name },
								);

								// Process states in batches
								const stateBatchSize = 10;
								for (let j = 0; j < states.length; j += stateBatchSize) {
									const statesBatch = states.slice(j, j + stateBatchSize);
									await Promise.all(
										statesBatch.map(async (state: any) => {
											try {
												const stateDoc = await State.create({
													name: state?.name,
													country_id: countryDoc._id,
													country_code: countryDoc?.iso3,
													state_code: state?.state_code,
												});

												const cities = await this.fetchCity(
													this.getApiBaseUrl('city'),
													{
														country: country.name,
														state: state.name,
													},
												);

												// Process cities in batches
												const cityBatchSize = 10;
												for (let k = 0; k < cities.length; k += cityBatchSize) {
													const citiesBatch = cities.slice(k, k + cityBatchSize);

													try {
														await City.insertMany(
															citiesBatch.map((city: any) => ({
																name: city,
																country_id: countryDoc._id,
																country_code: countryDoc?.iso3,
																state_id: stateDoc._id,
																state_code: stateDoc?.state_code,
															})),
														);
													} catch (cityError: any) {
														logger.error(
															`Failed to insert cities ${citiesBatch}: ${cityError.message}`,
														);
													}
												}
											} catch (stateError: any) {
												logger.error(
													`Failed to create state ${state.name}: ${stateError.message}`,
												);
											}
										}),
									);
								}
							}
						} catch (countryError: any) {
							logger.error(
								`Failed to create country ${country.name}: ${countryError.message}`,
							);
						}
					}),
				);
			}

			logger.info('Successfully inserted country, state, and city data.');
			process.exit(0);
		} catch (error: any) {
			logger.error(
				'Error while fetching country, state, and city data:',
				error,
			);
			process.exit(1);
		}
	}
}

const dataInserter = new DataInserter();
dataInserter.insertCountryStateCity();
