import { PLUGIN_ID } from './pluginId';

const LOGIN_PATH_PATTERN = /^\/admin\/auth\/login\/?$/;
const BUTTON_DATA_ATTR = 'data-oidc-sso-button';
const ALERT_DATA_ATTR = 'data-oidc-sso-alert';
const SSO_LOGIN_URL = '/oidc-sso/login';
const UI_CONFIG_URL = '/oidc-sso/ui-config';
const ERROR_QUERY_KEY = 'oidc_error';

type ButtonStyle = {
  background?: string;
  color?: string;
  borderColor?: string;
  hoverBackground?: string;
  hoverColor?: string;
};

type UiConfig = {
  label: string;
  icon: string | null;
  style: ButtonStyle | null;
};

const DEFAULT_UI_CONFIG: UiConfig = {
  label: 'Login with SSO',
  icon: null,
  style: null,
};

const ERROR_MESSAGES: Record<string, { title: string; body: string }> = {
  USER_NOT_PROVISIONED: {
    title: 'Account not provisioned',
    body:
      "Your SSO account isn't registered as a Strapi admin yet. Please contact an administrator to grant access.",
  },
  USER_DISABLED: {
    title: 'Account disabled',
    body: 'Your Strapi admin account is disabled. Contact an administrator to re-enable it.',
  },
  DOMAIN_NOT_ALLOWED: {
    title: 'Email domain not allowed',
    body: "Sign-in from your email domain isn't permitted on this Strapi instance.",
  },
  ROLES_NOT_FOUND: {
    title: 'Configuration error',
    body:
      'The default roles configured for SSO sign-up do not exist. Ask an administrator to fix the OIDC plugin configuration.',
  },
  INVALID_OIDC_FLOW: {
    title: 'Sign-in flow invalid',
    body: 'The sign-in attempt was invalid or expired. Please try again.',
  },
  IDP_UNREACHABLE: {
    title: 'Identity provider unreachable',
    body: "Couldn't reach the identity provider. Please try again or contact an administrator.",
  },
  MAPPING_REJECTED: {
    title: 'Sign-in rejected',
    body: 'Sign-in was rejected by the user-mapping rules configured for this Strapi instance.',
  },
  SESSION_MANAGER_UNAVAILABLE: {
    title: 'Strapi session manager unavailable',
    body: 'Upgrade Strapi to v5.24.1 or later to enable SSO sign-in.',
  },
  ACCESS_TOKEN_FAILED: {
    title: 'Could not issue access token',
    body: 'The Strapi admin session could not be created. Please try again.',
  },
};

const FALLBACK_MESSAGE = {
  title: 'Sign-in failed',
  body: 'An unknown error occurred during SSO sign-in.',
};

const styleId = 'oidc-sso-styles';

let uiConfigCache: UiConfig | null = null;
let uiConfigPromise: Promise<UiConfig> | null = null;

const fetchUiConfig = async (): Promise<UiConfig> => {
  if (uiConfigCache) return uiConfigCache;
  if (uiConfigPromise) return uiConfigPromise;
  uiConfigPromise = (async () => {
    try {
      const res = await fetch(UI_CONFIG_URL, { credentials: 'omit' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as Partial<UiConfig>;
      const merged: UiConfig = {
        label: typeof json.label === 'string' && json.label ? json.label : DEFAULT_UI_CONFIG.label,
        icon: typeof json.icon === 'string' && json.icon ? json.icon : null,
        style:
          json.style && typeof json.style === 'object'
            ? (json.style as ButtonStyle)
            : null,
      };
      uiConfigCache = merged;
      return merged;
    } catch {
      uiConfigCache = DEFAULT_UI_CONFIG;
      return DEFAULT_UI_CONFIG;
    } finally {
      uiConfigPromise = null;
    }
  })();
  return uiConfigPromise;
};

const ensureStylesInjected = (style: ButtonStyle | null) => {
  const existing = document.getElementById(styleId);
  if (existing) existing.remove();

  const bg = style?.background ?? 'var(--color-neutral-0, #fff)';
  const color = style?.color ?? 'var(--color-primary-600, #4945FF)';
  const border = style?.borderColor ?? 'var(--color-primary-600, #4945FF)';
  const hoverBg = style?.hoverBackground ?? 'var(--color-primary-100, #f0f0ff)';
  const hoverColor = style?.hoverColor ?? color;

  const el = document.createElement('style');
  el.id = styleId;
  el.textContent = `
    [${BUTTON_DATA_ATTR}] {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      margin-top: var(--size-4, 1rem);
      padding: 10px 16px;
      text-align: center;
      text-decoration: none;
      border-radius: 4px;
      border: 1px solid ${border};
      background: ${bg};
      color: ${color};
      font-family: inherit;
      font-weight: 600;
      font-size: 0.875rem;
      line-height: 1.43;
      cursor: pointer;
      box-sizing: border-box;
      transition: background-color .12s ease, color .12s ease, border-color .12s ease;
    }
    [${BUTTON_DATA_ATTR}]:hover {
      background: ${hoverBg};
      color: ${hoverColor};
    }
    [${BUTTON_DATA_ATTR}] .oidc-sso-button-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px; height: 18px;
      flex: 0 0 auto;
    }
    [${BUTTON_DATA_ATTR}] .oidc-sso-button-icon img,
    [${BUTTON_DATA_ATTR}] .oidc-sso-button-icon svg {
      width: 100%; height: 100%; display: block;
    }
    [${ALERT_DATA_ATTR}] {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      margin: 0 0 var(--size-4, 1rem) 0;
      padding: 12px 16px;
      border-radius: 4px;
      border: 1px solid var(--color-danger-200, #f5c0b8);
      background: var(--color-danger-100, #fcecea);
      color: var(--color-danger-700, #b72b1a);
      font-family: inherit;
      font-size: 0.875rem;
      line-height: 1.43;
    }
    [${ALERT_DATA_ATTR}] .oidc-sso-alert-icon {
      flex: 0 0 auto;
      width: 20px; height: 20px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 999px;
      background: var(--color-danger-600, #d02b20);
      color: #fff;
      font-weight: 700;
      font-size: 0.75rem;
    }
    [${ALERT_DATA_ATTR}] .oidc-sso-alert-title {
      margin: 0 0 4px 0;
      font-weight: 600;
      color: var(--color-danger-700, #b72b1a);
    }
    [${ALERT_DATA_ATTR}] .oidc-sso-alert-body {
      margin: 0;
      color: var(--color-neutral-800, #32324d);
    }
    [${ALERT_DATA_ATTR}] .oidc-sso-alert-close {
      margin-left: auto;
      background: transparent;
      border: 0;
      cursor: pointer;
      padding: 0 4px;
      color: var(--color-neutral-600, #666687);
      font-size: 1rem;
      line-height: 1;
    }
  `;
  document.head.appendChild(el);
};

const renderIcon = (icon: string | null): HTMLSpanElement | null => {
  if (!icon) return null;
  const wrap = document.createElement('span');
  wrap.className = 'oidc-sso-button-icon';
  const trimmed = icon.trim();
  if (trimmed.startsWith('<svg')) {
    wrap.innerHTML = trimmed;
  } else {
    const img = document.createElement('img');
    img.src = icon;
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    wrap.appendChild(img);
  }
  return wrap;
};

const renderButton = (cfg: UiConfig): HTMLAnchorElement => {
  const a = document.createElement('a');
  a.href = SSO_LOGIN_URL;
  a.setAttribute(BUTTON_DATA_ATTR, '');
  a.setAttribute('data-testid', 'oidc-sso-login');

  const icon = renderIcon(cfg.icon);
  if (icon) a.appendChild(icon);

  const text = document.createElement('span');
  text.textContent = cfg.label;
  a.appendChild(text);

  return a;
};

const renderAlert = (code: string): HTMLDivElement => {
  const msg = ERROR_MESSAGES[code] ?? FALLBACK_MESSAGE;
  const wrap = document.createElement('div');
  wrap.setAttribute(ALERT_DATA_ATTR, '');
  wrap.setAttribute('role', 'alert');

  const icon = document.createElement('span');
  icon.className = 'oidc-sso-alert-icon';
  icon.textContent = '!';
  icon.setAttribute('aria-hidden', 'true');

  const content = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'oidc-sso-alert-title';
  title.textContent = msg.title;
  const body = document.createElement('p');
  body.className = 'oidc-sso-alert-body';
  body.textContent = msg.body;
  content.appendChild(title);
  content.appendChild(body);

  const close = document.createElement('button');
  close.className = 'oidc-sso-alert-close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = '✕';
  close.addEventListener('click', () => wrap.remove());

  wrap.appendChild(icon);
  wrap.appendChild(content);
  wrap.appendChild(close);
  return wrap;
};

const isOnLoginPage = (): boolean => LOGIN_PATH_PATTERN.test(window.location.pathname);

const getErrorCode = (): string | null => {
  const params = new URLSearchParams(window.location.search);
  return params.get(ERROR_QUERY_KEY);
};

const clearErrorParam = () => {
  const url = new URL(window.location.href);
  if (url.searchParams.has(ERROR_QUERY_KEY)) {
    url.searchParams.delete(ERROR_QUERY_KEY);
    window.history.replaceState({}, '', url.toString());
  }
};

const tryInject = (cfg: UiConfig): boolean => {
  if (!isOnLoginPage()) return false;
  ensureStylesInjected(cfg.style);
  const form = document.querySelector<HTMLFormElement>('form');
  if (!form) return false;

  const errorCode = getErrorCode();
  if (errorCode && !document.querySelector(`[${ALERT_DATA_ATTR}]`)) {
    form.insertBefore(renderAlert(errorCode), form.firstChild);
    clearErrorParam();
  }

  if (!document.querySelector(`[${BUTTON_DATA_ATTR}]`)) {
    form.appendChild(renderButton(cfg));
  }
  return true;
};

const startLoginPageObserver = (cfg: UiConfig) => {
  if (tryInject(cfg)) return;

  const observer = new MutationObserver(() => {
    tryInject(cfg);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const cleanupOnNav = () => {
    if (!isOnLoginPage()) {
      document
        .querySelectorAll(`[${BUTTON_DATA_ATTR}], [${ALERT_DATA_ATTR}]`)
        .forEach((el) => el.remove());
    }
  };
  window.addEventListener('popstate', cleanupOnNav);
  window.addEventListener('hashchange', cleanupOnNav);
};

type App = {
  registerPlugin: (descriptor: { id: string; name: string }) => void;
};

export default {
  register(app: App) {
    app.registerPlugin({ id: PLUGIN_ID, name: 'OIDC SSO' });
  },

  async bootstrap(_app: App) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const cfg = await fetchUiConfig();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => startLoginPageObserver(cfg));
    } else {
      startLoginPageObserver(cfg);
    }
  },

  registerTrads: async ({ locales }: { locales: string[] }) => {
    return Promise.all(
      locales.map(async (locale) => {
        try {
          const data = await import(`./translations/${locale}.json`);
          return { data: (data as { default: Record<string, string> }).default, locale };
        } catch {
          return { data: {}, locale };
        }
      })
    );
  },
};
