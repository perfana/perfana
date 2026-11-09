import { cascadeTemplatesSentence } from '../cascade-templates';

describe('cascadeTemplatesSentence (D14)', () => {
  it('says nothing for a profile with no templates, or before the count is known', () => {
    expect(cascadeTemplatesSentence(0)).toBe('');
    expect(cascadeTemplatesSentence(undefined)).toBe('');
  });

  it('names how many templates the delete cascades to, provisioned ones included', () => {
    expect(cascadeTemplatesSentence(1)).toMatch(/^ It also deletes its ADAPT template, including any provisioned from template_ds_compare_configs\.yaml: the panels it configured/);
    expect(cascadeTemplatesSentence(4)).toMatch(/It also deletes its 4 ADAPT templates, including any provisioned .*the panels they configured/);
  });
});
