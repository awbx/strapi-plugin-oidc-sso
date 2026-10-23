# strapi-plugin-oidc-sso

Generic OIDC SSO for the Strapi v5 admin panel. Works with any OpenID Connect–compliant identity provider — Microsoft Entra ID, Google, Auth0, Keycloak, Okta, AWS Cognito, etc.

- Adds a "Login with SSO" button to the Strapi admin login page
- Full OIDC authorization-code flow with PKCE, state, and nonce
- ID token signature validation via the provider's JWKS
- Find-or-create Strapi admin users (configurable auto-provisioning)
- Issues a real Strapi v5 admin session via `strapi.sessionManager` — no monkey-patching of Strapi core
- Customizable button (label, icon, colors)
- Strapi-styled error banners on the login page when sign-in fails
- Multi-tenant Microsoft `/common/` and `/organizations/` endpoints handled via manual `iss` validation against the actual tenant

## Requirements

- Strapi `^5.24.1` (uses `strapi.sessionManager`, introduced in 5.24)
- Node `>=20`

## Installation

```sh
npm install strapi-plugin-oidc-sso
# or
pnpm add strapi-plugin-oidc-sso
# or
yarn add strapi-plugin-oidc-sso
```

## Configuration

Add the plugin to `config/plugins.ts` (or `.js`):

```ts
export default ({ env }) => ({
  'oidc-sso': {
    enabled: env.bool('OIDC_ENABLED', false),
    config: {
      // Either set `issuer` for OIDC discovery, OR set explicit endpoints below.
      issuer: env('OIDC_ISSUER'),
      endpoints: {
        authorization: env('OIDC_AUTHZ_URL'),    // optional override
        token:         env('OIDC_TOKEN_URL'),    // optional override
        userinfo:      env('OIDC_USERINFO_URL'), // optional override
        jwks:          env('OIDC_JWKS_URL'),     // optional override
        endSession:    env('OIDC_END_SESSION_URL'),
      },
      clientId:     env('OIDC_CLIENT_ID'),
      clientSecret: env('OIDC_CLIENT_SECRET'),
      redirectUri:  env('OIDC_REDIRECT_URI', 'http://localhost:1337/oidc-sso/callback'),
      scopes:       env.array('OIDC_SCOPES', ['openid', 'profile', 'email']),

      // Map verified id_token claims → Strapi admin user fields. Throw to reject login.
      userMapping: (claims) => ({
        email:     claims.preferred_username ?? claims.email,
        firstName: claims.given_name ?? claims.name?.split(' ')?.[0],
        lastName:  claims.family_name ?? '',
      }),

      autoCreateUsers: env.bool('OIDC_AUTO_CREATE', false),
      defaultRoles:    env.array('OIDC_DEFAULT_ROLES', []),
      allowedDomains:  env.array('OIDC_ALLOWED_DOMAINS', []),
      useUserinfo:     env.bool('OIDC_USE_USERINFO', false),

      // Security options
      requireEmailVerified: env.bool('OIDC_REQUIRE_EMAIL_VERIFIED', false),
      allowedTenantIds:     env.array('OIDC_ALLOWED_TENANT_IDS', []),
      secureCookies:        env.bool('OIDC_SECURE_COOKIES', false),

      // Button branding (all optional)
      buttonLabel: env('OIDC_BUTTON_LABEL', 'Login with SSO'),
      buttonIcon:  env('OIDC_BUTTON_ICON'), // URL, data URI, or inline <svg>...</svg>
      buttonStyle: {
        background:      env('OIDC_BUTTON_BACKGROUND'),
        color:           env('OIDC_BUTTON_COLOR'),
        borderColor:     env('OIDC_BUTTON_BORDER_COLOR'),
        hoverBackground: env('OIDC_BUTTON_HOVER_BACKGROUND'),
        hoverColor:      env('OIDC_BUTTON_HOVER_COLOR'),
      },
    },
  },
});
```

### Configuration reference

| Field             | Required | Description |
|-------------------|----------|-------------|
| `issuer`          | one of   | OIDC issuer URL — used for `.well-known/openid-configuration` discovery |
| `endpoints.*`     | one of   | Explicit endpoint overrides; any field set here wins per-field over discovery. Without `issuer`, token signatures are checked against `endpoints.jwks` but the token `iss` claim is not asserted |
| `clientId`        | yes      | OAuth client ID |
| `clientSecret`    | yes      | OAuth client secret |
| `redirectUri`     | yes      | Must match the URI registered with the IdP. Plugin serves `/oidc-sso/callback` |
| `scopes`          | yes      | Defaults to `['openid', 'profile', 'email']` |
| `userMapping`     | yes      | `(claims, ctx) => ({ email, firstName?, lastName?, username?, groups? })`. Async allowed. Throw to reject. |
| `autoCreateUsers` | no       | If `true`, unknown emails are auto-provisioned with `defaultRoles`. Default `false` |
| `defaultRoles`    | no       | Strapi admin role codes (e.g. `strapi-super-admin`, `strapi-editor`, `strapi-author`) |
| `allowedDomains`  | no       | If non-empty, only emails whose domain matches are allowed |
| `useUserinfo`     | no       | If `true`, also fetches the userinfo endpoint and merges its claims |
| `requireEmailVerified` | no | If `true`, only sign-ins whose `email_verified` claim is `true` are accepted. Default `false` |
| `allowedTenantIds` | no      | Allow-list of tenant ids (`tid`) accepted in multi-tenant setups. If non-empty, every other tenant is rejected |
| `secureCookies`   | no       | Forces the `Secure` flag on the state and refresh cookies. Default: the request's scheme (`ctx.secure`) |
| `buttonLabel`     | no       | Default `Login with SSO` |
| `buttonIcon`      | no       | Image URL, data URI, or inline `<svg>...</svg>` |
| `buttonStyle.*`   | no       | CSS color overrides — all default to Strapi's design tokens |

You must provide either `issuer` (for discovery) or all of `endpoints.{authorization, token, jwks}`.
`scopes` must contain `openid` — without it the IdP issues no `id_token` and the sign-in cannot be verified.

## Running behind a reverse proxy

If a proxy serves Strapi under a path prefix — nginx exposing it at `/strapi` and
stripping the prefix before proxying, say — set `PUBLIC_URL` (i.e. `server.url`)
to the public URL *including* that prefix:

```sh
PUBLIC_URL=https://example.com/strapi
```

The plugin derives every browser-facing path from Strapi's own `admin.absoluteUrl`,
which Strapi computes from `server.url`. With `PUBLIC_URL` set correctly you get:

| | Value |
|---|---|
| Redirect URI to register with the IdP | `https://example.com/strapi/oidc-sso/callback` |
| Post-login landing | `https://example.com/strapi/admin` |
| Error banner target | `https://example.com/strapi/admin/auth/login` |
| Refresh-cookie path | `/strapi/admin` |

The admin-side button resolves the prefix from the URL in the address bar, so it
requests `/strapi/oidc-sso/login` rather than `/oidc-sso/login`.

If `PUBLIC_URL` omits the prefix, the prefix is invisible to Strapi and sign-in
completes but lands the browser on `/admin`, which the proxy will route to
whatever else sits at the site root.

## Provider examples

All examples assume `OIDC_REDIRECT_URI=http://localhost:1337/oidc-sso/callback` in development. Replace with your public URL in production and register the same URI verbatim with the IdP.

### Microsoft Entra ID — single tenant

```sh
OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
```

Setup:
1. Entra admin centre → **App registrations** → New registration.
2. **Authentication** → Add platform → **Web** → set the redirect URI.
3. **Certificates & secrets** → New client secret → copy the value into `OIDC_CLIENT_SECRET`.
4. **API permissions** → keep the default `User.Read` (Microsoft Graph).

```ts
userMapping: (claims) => ({
  email:     claims.preferred_username ?? claims.email,
  firstName: claims.given_name,
  lastName:  claims.family_name,
}),
```

### Microsoft Entra ID — multi-tenant (any work/school account)

```sh
OIDC_ISSUER=https://login.microsoftonline.com/common/v2.0
# or /organizations/v2.0 to exclude personal MSAs
```

Switch the app registration to "Accounts in any organizational directory". The plugin auto-detects the `{tenantid}` placeholder in `/common/` discovery and validates the id_token's actual `tid` against the JWKS — no extra config needed. Combine with `allowedDomains` to restrict which tenants can sign in.

### Google

```sh
OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=...apps.googleusercontent.com
OIDC_CLIENT_SECRET=...
OIDC_SCOPES=openid,profile,email
```

Setup:
1. Google Cloud Console → **APIs & Services → OAuth consent screen** → configure (Internal if you use Workspace).
2. **Credentials** → **Create credentials** → OAuth 2.0 Client ID → Web application.
3. Add the redirect URI under **Authorized redirect URIs**.

Restrict to a single Google Workspace domain via the `hd` claim:

```ts
userMapping: (claims) => {
  if (claims.hd !== 'example.com') throw new Error('Not a company account');
  return {
    email:     claims.email,
    firstName: claims.given_name,
    lastName:  claims.family_name,
  };
},
```

### Okta

```sh
OIDC_ISSUER=https://<your-org>.okta.com/oauth2/default
# or a custom auth server: https://<your-org>.okta.com/oauth2/<auth-server-id>
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
```

Setup:
1. Okta admin → **Applications** → Create App Integration → **OIDC – Web Application**.
2. Sign-in redirect URIs → add the callback URL.
3. Assign users / groups under **Assignments**.

Pass Okta groups through if you include the `groups` scope and configure a groups claim on the auth server:

```ts
scopes: ['openid', 'profile', 'email', 'groups'],
userMapping: (claims) => ({
  email:     claims.email,
  firstName: claims.given_name,
  lastName:  claims.family_name,
  groups:    claims.groups as string[] | undefined,
}),
```

### Auth0

```sh
OIDC_ISSUER=https://<tenant>.auth0.com/   # trailing slash matters
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
```

Setup:
1. Auth0 dashboard → **Applications** → Create Application → **Regular Web Application**.
2. **Settings** → set **Allowed Callback URLs** to the redirect URI.
3. (Optional) add a custom claim via an [Action](https://auth0.com/docs/customize/actions) to forward roles/groups — Auth0 strips non-OIDC claim names, so namespace them:

```js
// Auth0 Action — Login / Post Login
exports.onExecutePostLogin = async (event, api) => {
  api.idToken.setCustomClaim('https://strapi/roles', event.authorization?.roles ?? []);
};
```

```ts
userMapping: (claims) => ({
  email:     claims.email,
  firstName: claims.given_name,
  lastName:  claims.family_name,
  groups:    claims['https://strapi/roles'] as string[] | undefined,
}),
```

### AWS Cognito

```sh
OIDC_ISSUER=https://cognito-idp.<region>.amazonaws.com/<user-pool-id>
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
```

Setup:
1. Cognito → User pools → your pool → **App integration** → create an **App client** (with secret).
2. Configure a **Hosted UI domain** and add the callback URL under **Allowed callback URLs**.
3. Enable identity providers (Cognito User Pool, Google, SAML, etc.) on the app client.

Cognito puts emails in `email` and the username in `cognito:username`:

```ts
userMapping: (claims) => ({
  email:     claims.email,
  username:  claims['cognito:username'],
  firstName: claims.given_name,
  lastName:  claims.family_name,
  groups:    claims['cognito:groups'] as string[] | undefined,
}),
```

### Keycloak

```sh
OIDC_ISSUER=https://keycloak.example.com/realms/<realm>
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
```

Setup:
1. Keycloak admin → realm → **Clients** → Create client → OpenID Connect, **Client authentication** ON.
2. Valid redirect URIs → add the callback URL.
3. **Credentials** tab → copy the client secret.

Forward realm/client roles via the built-in `roles` scope:

```ts
scopes: ['openid', 'profile', 'email', 'roles'],
userMapping: (claims) => ({
  email:     claims.email,
  firstName: claims.given_name,
  lastName:  claims.family_name,
  groups:    (claims.realm_access as { roles?: string[] } | undefined)?.roles,
}),
```

### Authentik

```sh
OIDC_ISSUER=https://authentik.example.com/application/o/<slug>/
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
```

Create an OAuth2/OpenID provider, then an application that points at it. The issuer ends with the application slug and a trailing slash.

### GitHub

GitHub OAuth apps **do not implement OpenID Connect** — they don't issue an `id_token`, so this plugin can't talk to GitHub directly. Bridge GitHub through an OIDC-capable IdP:

- **Auth0** — add GitHub as a social connection, then point the plugin at your Auth0 tenant (see above).
- **Keycloak** — add a GitHub **Identity provider** under your realm, then point the plugin at the realm.
- **Authentik** — add a GitHub **Source**, then expose it through an OAuth2/OpenID provider.
- **AWS Cognito** — federate GitHub via a custom OIDC/SAML identity provider on the user pool.

The plugin sees the bridge IdP; the bridge handles the GitHub OAuth dance and re-issues a proper OIDC `id_token` carrying the GitHub claims.

## How it works

```
[Login Page]                       [Strapi Server]              [IdP]
     │                                    │                       │
  click "Login with SSO"                  │                       │
     │── GET /oidc-sso/login ────────────▶│                       │
     │◀── 302 to IdP (state, nonce, PKCE)─│                       │
     │── user authenticates ────────────────────────────────────▶│
     │◀── 302 /oidc-sso/callback?code ──────────────────────────│
     │── GET /oidc-sso/callback ─────────▶│                       │
     │                                    │── code → tokens ─────▶│
     │                                    │── verify id_token     │
     │                                    │── find-or-create user │
     │                                    │── sessionManager → JWT│
     │◀── HTML handoff (sets jwtToken,    │                       │
     │    redirects to /admin) ───────────│                       │
     │                                                            │
  user lands in /admin, fully logged in                           │
```

The handoff page is a per-request CSP-noncedened HTML response — no React route needed, no auth context plumbing. The Strapi admin shell takes over via its standard `localStorage.jwtToken` boot sequence.

## Security

| Threat                       | Mitigation                                                        |
|------------------------------|-------------------------------------------------------------------|
| Authorization-code injection | `state` parameter, signed cookie, one-shot                        |
| ID-token replay              | `nonce` parameter, verified                                       |
| ID-token forgery             | JWKS signature check, `iss`, `aud`, `exp` validated               |
| Stolen authorization code    | PKCE (`S256` code_challenge + code_verifier)                      |
| Token leakage via referer    | Access token only sent in HTML body, never in URL                 |
| Session fixation             | Fresh Strapi access + refresh tokens issued on every successful login |
| Disabled users               | `isActive`/`blocked` flags checked before issuing tokens          |
| Unwanted sign-ups            | `autoCreateUsers` is `false` by default                           |
| Unverified email addresses   | `email_verified: false` is always rejected; `requireEmailVerified` additionally demands `email_verified: true` |
| Cross-tenant sign-in         | `allowedTenantIds` restricts multi-tenant issuers to known tenants |
| Cookie tampering             | State cookie HMAC-signed with `ADMIN_JWT_SECRET`                  |

### Verified email addresses

The plugin reads the `email_verified` claim from the merged claims set — the `id_token`,
plus the userinfo response when `useUserinfo` is enabled (both come from the IdP and are
bound to the same authenticated session):

- `email_verified: false` → the sign-in is rejected with `EMAIL_NOT_VERIFIED`, always,
  independently of the configuration.
- `email_verified: true` → the sign-in proceeds.
- the claim is missing → the sign-in proceeds, unless `requireEmailVerified` is enabled.

With `requireEmailVerified: true` only an explicit `email_verified: true` is accepted; a missing
claim is treated like a failed verification. Note that not every IdP sends the claim — check yours
before enabling it.

### Multi-tenant setups

An issuer such as `https://login.microsoftonline.com/common/v2.0` accepts accounts from *every*
tenant of the IdP, and the plugin validates the tenant against the JWKS of that issuer. Any tenant
that exists at the IdP can therefore claim an admin account on this instance. Set
`allowedTenantIds` to the list of tenant ids you trust:

```ts
allowedTenantIds: ['11111111-2222-3333-4444-555555555555'],
```

Tenants outside the list are rejected during the token exchange. The plugin logs a warning at
startup while a multi-tenant issuer is configured without an allow-list.

## Provider-specific quirks the plugin handles

- **Microsoft `/common/` and `/organizations/`** — the discovery doc returns `iss: "https://login.microsoftonline.com/{tenantid}/v2.0"` literally. The plugin detects the `{tenantid}` placeholder, decodes the id_token to get the real `tid`, and validates against the expanded issuer URL using `jose` + the discovered JWKS.
- **Empty allow-list parsed as `[""]`** — `env.array('FOO', [])` parses `""` as `[""]`. The plugin filters empty strings before checking `allowedDomains`.

## Development

```sh
pnpm install
pnpm build      # SDK build + tsc declaration emit
pnpm verify     # @strapi/sdk-plugin package shape check
pnpm watch:link # live-link into a host Strapi app
```

## License

MIT
