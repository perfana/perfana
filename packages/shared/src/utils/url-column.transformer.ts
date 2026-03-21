import { ValueTransformer } from 'typeorm';

/**
 * TypeORM column transformer that strips trailing slashes from URL values.
 * Applied on both read (from DB) and write (to DB) to prevent double-slash
 * issues when URLs are concatenated with paths (e.g. `${baseUrl}/api/...`).
 */
export const stripTrailingSlashTransformer: ValueTransformer = {
  from: (value: string | null) => (value ? value.replace(/\/+$/, '') : value),
  to: (value: string | null) => (value ? value.replace(/\/+$/, '') : value),
};
