import type { Core } from '@strapi/strapi';

export type Claims = Record<string, unknown>;

export type MappedUser = {
  email: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  groups?: string[];
};

export type UserMappingContext = {
  idToken: string;
  accessToken?: string;
  strapi: Core.Strapi;
};

export type UserMappingFn = (
  claims: Claims,
  ctx: UserMappingContext
) => MappedUser | Promise<MappedUser>;

export type EndpointOverrides = {
  authorization?: string;
  token?: string;
  userinfo?: string;
  jwks?: string;
  endSession?: string;
};

export type ButtonStyle = {
  background?: string;
  color?: string;
  borderColor?: string;
  hoverBackground?: string;
  hoverColor?: string;
};

export type PluginConfig = {
  issuer?: string;
  endpoints?: EndpointOverrides;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  userMapping: UserMappingFn;
  autoCreateUsers: boolean;
  defaultRoles: string[];
  allowedDomains: string[];
  useUserinfo: boolean;
  buttonLabel: string;
  buttonIcon?: string;
  buttonStyle?: ButtonStyle;
};

export type ResolvedProfile = MappedUser & {
  rawClaims: Claims;
};
