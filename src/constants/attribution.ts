// Google attribution for Places content (Phase 12.5; Maps ToS accepted risk, Mohit 2026-09-27).
// Every in-app response that carries Places content (business names, ratings, reviews) includes
// `attribution`, and PDFs / share pages print the text next to that content.
// Wording: Google's Places policy text "Google Maps" (Mohit, 2026-09-27; was "Business data © Google").
export const GOOGLE_ATTRIBUTION = { provider: 'Google', text: 'Google Maps' } as const;
export type GoogleAttribution = typeof GOOGLE_ATTRIBUTION;
