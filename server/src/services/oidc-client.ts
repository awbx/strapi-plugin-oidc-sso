import { Issuer, generators, type Client, type IssuerMetadata } from 'openid-client';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import type { Core } from '@strapi/strapi';
import type { PluginConfig } from '../types';

const TENANT_PLACEHOLDER = '{tenantid}';

type OidcClientService = {
  init: () => Promise<void>;
  getAuthorizationUrl: () => {
    url: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  };
  exchangeCode: (
    callbackParams: Record<string, string>,
    flowState: { state: string; nonce: string; codeVerifier: string }
  ) => Promise<{
    idToken: string;
    accessToken?: string;
    claims: Record<string, unknown>;
  }>;
  userinfo: (accessToken: string) => Promise<Record<string, unknown>>;
  getEndSessionUrl: (args: { idTokenHint?: string; postLogoutRedirectUri?: string }) =>
    | string
    | undefined;
};

let cachedClient: Client | null = null;

const getConfig = (strapi: Core.Strapi): PluginConfig =>
  strapi.config.get('plugin::oidc-sso') as PluginConfig;

const buildIssuerMetadata = async (cfg: PluginConfig): Promise<IssuerMetadata> => {
  const overrides = cfg.endpoints ?? {};

  let base: IssuerMetadata = { issuer: cfg.issuer ?? 'oidc-sso-static' };

  if (cfg.issuer) {
    const discovered = await Issuer.discover(cfg.issuer);
    base = { ...discovered.metadata } as IssuerMetadata;
  }

  return {
    ...base,
    ...(overrides.authorization && { authorization_endpoint: overrides.authorization }),
    ...(overrides.token && { token_endpoint: overrides.token }),
    ...(overrides.userinfo && { userinfo_endpoint: overrides.userinfo }),
    ...(overrides.jwks && { jwks_uri: overrides.jwks }),
    ...(overrides.endSession && { end_session_endpoint: overrides.endSession }),
    issuer: base.issuer || cfg.issuer || 'oidc-sso-static',
  };
};

export default ({ strapi }: { strapi: Core.Strapi }): OidcClientService => ({
  async init() {
    const cfg = getConfig(strapi);
    const metadata = await buildIssuerMetadata(cfg);
    const issuer = new Issuer(metadata);

    cachedClient = new issuer.Client({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uris: [cfg.redirectUri],
      response_types: ['code'],
    });
  },

  getAuthorizationUrl() {
    if (!cachedClient) {
      throw new Error('[oidc-sso] OIDC client is not initialised');
    }
    const cfg = getConfig(strapi);
    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    const url = cachedClient.authorizationUrl({
      scope: cfg.scopes.join(' '),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return { url, state, nonce, codeVerifier };
  },

  async exchangeCode(callbackParams, flowState) {
    if (!cachedClient) {
      throw new Error('[oidc-sso] OIDC client is not initialised');
    }
    const cfg = getConfig(strapi);
    const issuerTemplate = cachedClient.issuer.metadata.issuer;
    const isTemplated = issuerTemplate?.includes(TENANT_PLACEHOLDER) ?? false;

    // Validate state up-front (callback() would normally do this, but we may bypass it)
    const returnedState =
      typeof callbackParams.state === 'string' ? callbackParams.state : undefined;
    if (returnedState !== flowState.state) {
      throw new Error('[oidc-sso] state mismatch');
    }
    const code = typeof callbackParams.code === 'string' ? callbackParams.code : undefined;
    if (!code) {
      throw new Error('[oidc-sso] no authorization code in callback');
    }

    if (!isTemplated) {
      const tokenSet = await cachedClient.callback(cfg.redirectUri, callbackParams, {
        state: flowState.state,
        nonce: flowState.nonce,
        code_verifier: flowState.codeVerifier,
      });
      if (!tokenSet.id_token) {
        throw new Error('[oidc-sso] provider did not return an id_token');
      }
      return {
        idToken: tokenSet.id_token,
        accessToken: tokenSet.access_token,
        claims: tokenSet.claims() as Record<string, unknown>,
      };
    }

    // Multi-tenant Microsoft path: exchange code, then validate id_token manually
    // because openid-client cannot match the literal '{tenantid}' issuer template
    // against the real tenant value present in id_token.iss.
    const tokenSet = await cachedClient.grant({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: flowState.codeVerifier,
    });

    if (!tokenSet.id_token) {
      throw new Error('[oidc-sso] provider did not return an id_token');
    }

    const unverified = decodeJwt(tokenSet.id_token) as {
      iss?: string;
      tid?: string;
      nonce?: string;
    };
    if (!unverified.tid) {
      throw new Error('[oidc-sso] id_token missing tid claim (multi-tenant)');
    }
    const expectedIssuer = (issuerTemplate as string).replace(
      TENANT_PLACEHOLDER,
      unverified.tid
    );

    const jwksUri = cachedClient.issuer.metadata.jwks_uri;
    if (!jwksUri) {
      throw new Error('[oidc-sso] issuer metadata missing jwks_uri');
    }
    const jwks = createRemoteJWKSet(new URL(jwksUri));
    const { payload } = await jwtVerify(tokenSet.id_token, jwks, {
      issuer: expectedIssuer,
      audience: cfg.clientId,
    });

    if (payload.nonce !== flowState.nonce) {
      throw new Error('[oidc-sso] id_token nonce mismatch');
    }

    return {
      idToken: tokenSet.id_token,
      accessToken: tokenSet.access_token,
      claims: payload as Record<string, unknown>,
    };
  },

  async userinfo(accessToken) {
    if (!cachedClient) {
      throw new Error('[oidc-sso] OIDC client is not initialised');
    }
    return (await cachedClient.userinfo(accessToken)) as Record<string, unknown>;
  },

  getEndSessionUrl({ idTokenHint, postLogoutRedirectUri }) {
    if (!cachedClient) return undefined;
    try {
      return cachedClient.endSessionUrl({
        id_token_hint: idTokenHint,
        post_logout_redirect_uri: postLogoutRedirectUri,
      });
    } catch {
      return undefined;
    }
  },
});
