/**
 * The sentence the profile delete confirmation adds for the profile's ADAPT templates, which the
 * `profile_id` foreign key deletes with it, provisioned ones included (design D14).
 */
export function cascadeTemplatesSentence(count: number | null | undefined): string {
  // null: the count could not be read, so warn without a number rather than say nothing.
  if (count === null) {
    return " It also deletes the profile's ADAPT templates, if it has any, including any provisioned from template_ds_compare_configs.yaml.";
  }
  if (!count) return '';
  const what = count === 1 ? 'its ADAPT template' : `its ${count} ADAPT templates`;
  return (
    ` It also deletes ${what}, including any provisioned from template_ds_compare_configs.yaml: the panels ` +
    `${count === 1 ? 'it' : 'they'} configured go back to their own configuration on each workload's next completed run.`
  );
}
