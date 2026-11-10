/**
 * Key on `benchmarks.metadata` marking a profile-provisioned SLO that was switched off by the
 * system rather than by a person: its profile SLO was deleted or retargeted (ProfilesService),
 * or the Dynatrace host query it reads was unmapped (DynatraceRepository). The value is the
 * reason. grafana-sync's provisioning sweep re-enables and re-syncs a row carrying it when the
 * profile SLO still matches that dashboard; a row a person disabled has `updated_by` set and no
 * marker, and stays off.
 */
export const PROVISIONED_SLO_AUTO_DISABLED_KEY = 'autoDisabled';
