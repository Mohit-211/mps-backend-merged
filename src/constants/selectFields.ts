export const roleSelect = "role_id name abbreviation is_active created_at";
export const countrySelect =
  "name currency unicodeFlag capital flag dialCode iso2 iso3 is_active created_at";
export const stateSelect =
  "name country_id country_code state_code is_active created_at";
export const citySelect =
  "name country_id country_code state_id state_code is_active created_at";
export const languageSelect = "name slug is_active created_at";
export const timezoneSelect = "time_zone is_active created_at";
export const faqSelect = "question answer is_active created_at";
export const clientSelect =
  "company_name company_URL unique_id status no_of_locations is_active created_by created_at";
export const supportSelect =
  "name email subject address message mobile is_active status created_at";
export const businessCategorySelect = "name slug is_active created_at";

export const locationSelect = "name address country lat lng state city zip_code mobile website_URL business_category client_id place_id created_by is_active created_at";
export const rankTrackerSelect = "location_id scheduling competitors keyword_list average_google_position google_local_pack_coverage keywords total_keywords keyword_and_positional_movement is_active created_at updated_at";
export const whitelabelProfileSelect = "location_id name header footer color file_type file_name file_uri file_size external external_url external_reports_lists client_access_restriction_for_reputation_manager access_password is_primary is_active created_at created_by";
export const localSearchGridSelect = "location_id keywords_up keywords_down total_keywords all_keywords_avg scheduling map_criteria keyword_list keywords is_active created_at updated_at";
export const localMapRankingSelect = "location_id keywords_up keywords_down total_keywords all_keywords_avg scheduling map_criteria keyword_list keywords is_active created_at updated_at";
export const citationDirectorySelect = "name url domain category country submission_type aggregators verification_required is_active created_at updated_at";