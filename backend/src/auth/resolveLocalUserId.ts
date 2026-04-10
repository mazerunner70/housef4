import type { AppConfig } from '../config';

/**
 * Local dev: when `APP_ENV=local` and `DEV_AUTH_USER_ID` is set, use it as `sub`
 * (see docs/03_detailed_design/backend_dev_and_prod_environments.md §6).
 * Never set `DEV_AUTH_USER_ID` on Lambda — Terraform omits it.
 */
export function resolveLocalUserId(cfg: AppConfig): string | undefined {
  if (cfg.appEnv !== 'local') return undefined;
  const id = cfg.devAuthUserId?.trim();
  return id && id.length > 0 ? id : undefined;
}
