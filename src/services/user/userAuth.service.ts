/* eslint-disable @typescript-eslint/no-explicit-any */
import { BodyDefinition, QueryDefinition } from "../../types/RouteDefinition";
import { gbpOAuthService } from "../gbp/oauth.service";
import { bindingService } from "../gbp/binding.service";

// GBP (Phase 6): one-time random state + business.manage only; see services/gbp/oauth.service.ts.
export const getGBPAuthUrl = async (body: BodyDefinition) => {
  const { user } = body;
  return gbpOAuthService.createAuthUrl(user._id);
};

export const getGBPPopupConfig = async (body: BodyDefinition) => {
  const { user } = body;
  return gbpOAuthService.createPopupConfig(user._id);
};

export const gBPPopupCode = async (body: BodyDefinition) => {
  const { user, code, state } = body;
  return gbpOAuthService.handlePopupCode(user._id, {
    code: typeof code === "string" ? code : undefined,
    state: typeof state === "string" ? state : undefined,
  });
};

export const gBPAuthCallback = async (query: QueryDefinition) =>
  gbpOAuthService.handleCallback({
    code: typeof query.code === "string" ? query.code : undefined,
    state: typeof query.state === "string" ? query.state : undefined,
    error: typeof query.error === "string" ? query.error : undefined,
  });

// Disconnect one connected Google account (body.google_sub; optional with a single connection):
// revoke it at Google (best effort), unbind only its profiles, cancel their jobs, delete its tokens.
export const gBPConnectionRevoke = async (body: BodyDefinition) => {
  const { user, google_sub } = body;
  return bindingService.disconnect(user._id, typeof google_sub === "string" ? google_sub : undefined);
};
