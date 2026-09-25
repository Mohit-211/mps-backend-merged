import { serpCountries } from "../constants";


export const getShortCountryCode = (country_name: string) =>{
    let country = serpCountries.find(elm => elm.country_name === country_name);
    return country && country.country_code ? country.country_code : null;
};