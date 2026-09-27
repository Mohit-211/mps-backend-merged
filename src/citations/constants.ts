// Citations (Phase 16): shared enums for the directory master list and the per-location citation lists.

export const DIRECTORY_TYPES = ['general', 'niche', 'aggregator', 'social', 'government_chamber'] as const;
export type DirectoryType = (typeof DIRECTORY_TYPES)[number];

export const CITATION_COUNTRIES = ['US', 'CA'] as const;
export type CitationCountry = (typeof CITATION_COUNTRIES)[number];

export const CITATION_STATUSES = ['not_checked', 'live_correct', 'nap_wrong', 'not_found', 'duplicate', 'submitted', 'pending', 'removed'] as const;
export type CitationStatus = (typeof CITATION_STATUSES)[number];

export const NAP_FIELDS = ['name', 'address', 'phone', 'website'] as const;
export type NapField = (typeof NAP_FIELDS)[number];

export const CITATION_SOURCES = ['suggested', 'manual'] as const;
export type CitationSource = (typeof CITATION_SOURCES)[number];

export const CITATION_LOG_ACTIONS = ['added', 'status_changed', 'checked', 'updated', 'removed_from_list', 'restored'] as const;
export type CitationLogAction = (typeof CITATION_LOG_ACTIONS)[number];

/** Shown to organization users instead of the platform admin's name. */
export const CUSTOMER_FACING_ACTOR = 'MyPageSEO team';
