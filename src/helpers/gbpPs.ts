import axios from 'axios';
import { google } from 'googleapis';

export const getBusinessLocations = async (accessToken: string) => {
    try {
        // Step 1: Fetch account ID first
        const accountResponse = await axios.get(
            'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        if (!accountResponse.data.accounts || accountResponse.data.accounts.length === 0) {
            console.error('No business accounts found.');
            return [];
        }

        const accountId = accountResponse.data.accounts[0].name; // Format: accounts/{accountId}
        console.log(`Found Account ID: ${accountId}`);
        // const accountId = 'Dipankar Bhoumik'
        console.log("1111111111111111 : ", accessToken)

        // Step 2: Fetch locations for the account
        const locationsResponse = await axios.get(
            `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );

        console.log("Fetched Locations: ", locationsResponse);
        return locationsResponse.data.locations || [];
    } catch (error) {
        console.error('Error fetching business locations:', error.response?.data || error.message);
        return null;
    }
};
