import { OnboardingStep, ONBOARDING_STEPS } from '../../models/location.model';

// Onboarding step rules (Phase 7a). Steps only move forward; 'completed' is set by /onboarding/complete.

export interface TrackingChange {
	/** Keywords stored after the update. */
	keywordCount: number;
	/** The update included a competitors field (even an empty list = "no competitors"). */
	competitorsSent: boolean;
}

const rank = (step: OnboardingStep): number => ONBOARDING_STEPS.indexOf(step);

/** The step after a tracking update, or null when it does not change. */
export const nextOnboardingStep = (current: OnboardingStep | undefined, change: TrackingChange): OnboardingStep | null => {
	if (!current || current === 'completed' || change.keywordCount === 0) return null;
	const target: OnboardingStep = change.competitorsSent ? 'competitors_set' : 'keywords_set';
	return rank(target) > rank(current) ? target : null;
};
