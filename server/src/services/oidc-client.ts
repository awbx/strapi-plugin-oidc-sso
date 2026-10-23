import { Issuer, generators, type Client, type IssuerMetadata } from 'openid-client';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import type { Core } from '@strapi/strapi';
import type { PluginConfig } from '../types';

const TENANT_PLACEHOLDER = '{tenantid}';
const STATIC_ISSUER = 'oidc-sso-static';

type OidcClientService = {
  init: () => Promise<void>;
  getAuthorizationUrl: () => Promise<{
    url: string;
    state: string;
    nonce: string;
    codeVerifier: string;
  }>;
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
let initPromise: Promise<Client> | null = null;

const getConfig = (strapi: Core.Strapi): PluginConfig =>
  strapi.config.get('plugin::oidc-sso') as PluginConfig;

const buildIssuerMetadata = async (cfg: PluginConfig): Promise<IssuerMetadata> => {
  const overrides = cfg.endpoints ?? {};

  let base: IssuerMetadata = { issuer: cfg.issuer ?? STATIC_ISSUER };

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
    issuer: base.issuer || cfg.issuer || STATIC_ISSUER,
  };
};

export default ({ strapi }: { strapi: Core.Strapi }): OidcClientService => {
  const initClient = async (): Promise<Client> => {
    const cfg = getConfig(strapi);
    const metadata = await buildIssuerMetadata(cfg);
    const issuer = new Issuer(metadata);

    const client = new issuer.Client({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uris: [cfg.redirectUri],
      response_types: ['code'],
    });

    cachedClient = client;
    return client;
  };

  // The IdP may be unreachable while Strapi boots; the client is therefore
  // created on first use instead of taking the whole server down. A failed
  // attempt is not cached, so the next request retries.
  const ensureClient = async (): Promise<Client> => {
    if (cachedClient) return cachedClient;
    if (!initPromise) {
      initPromise = initClient().finally(() => {
        initPromise = null;
      });
    }
    return initPromise;
  };

  return {
    async init() {
      await ensureClient();
    },

    async getAuthorizationUrl() {
      const client = await ensureClient();
      const cfg = getConfig(strapi);
      const state = generators.state();
      const nonce = generators.nonce();
      const codeVerifier = generators.codeVerifier();
      const codeChallenge = generators.codeChallenge(codeVerifier);

      const url = client.authorizationUrl({
        scope: cfg.scopes.join(' '),
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      return { url, state, nonce, codeVerifier };
    },

    async exchangeCode(callbackParams, flowState) {
      const client = await ensureClient();
      const cfg = getConfig(strapi);
      const issuerTemplate = client.issuer.metadata.issuer;
      const isTemplated = issuerTemplate?.includes(TENANT_PLACEHOLDER) ?? false;
      // Endpoints-only setup: no discovery document, so there is no issuer to
      // validate the id_token against — the manual path handles it.
      const isEndpointsOnly = cfg.issuer === undefined && issuerTemplate === STATIC_ISSUER;

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

      if (!isTemplated && !isEndpointsOnly) {
        const tokenSet = await client.callback(cfg.redirectUri, callbackParams, {
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

      // Manual validation path: exchange the code and verify the id_token
      // ourselves, because openid-client cannot do it for us
      //  - multi-tenant Microsoft: it cannot match the literal '{tenantid}'
      //    issuer template against the real tenant present in id_token.iss
      //  - endpoints-only setups: there is no issuer to validate against
      const tokenSet = await client.grant({
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

      let expectedIssuer: string | undefined;
      if (isTemplated) {
        if (!unverified.tid) {
          throw new Error('[oidc-sso] id_token missing tid claim (multi-tenant)');
        }
        const allowedTenants = cfg.allowedTenantIds ?? [];
        if (allowedTenants.length > 0 && !allowedTenants.includes(unverified.tid)) {
          throw new Error(
            `[oidc-sso] tenant "${unverified.tid}" is not in the allowedTenantIds allow-list`
          );
        }
        expectedIssuer = (issuerTemplate as string).replace(
          TENANT_PLACEHOLDER,
          unverified.tid
        );
      }

      const jwksUri = client.issuer.metadata.jwks_uri;
      if (!jwksUri) {
        throw new Error('[oidc-sso] issuer metadata missing jwks_uri');
      }
      const jwks = createRemoteJWKSet(new URL(jwksUri));
      const { payload } = await jwtVerify(tokenSet.id_token, jwks, {
        audience: cfg.clientId,
        ...(expectedIssuer ? { issuer: expectedIssuer } : {}),
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
  };
};
