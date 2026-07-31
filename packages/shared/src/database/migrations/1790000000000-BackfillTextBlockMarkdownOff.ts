import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Text block sections gained real markdown rendering. `config.markdown` defaults
 * to true, so every block authored BEFORE that would start rendering as markdown
 * the next time its template generates a report — silently renumbering explicit
 * ordered lists (`1. / 5. / 7.` becomes 1, 2, 3), collapsing indentation and
 * flattening nested bullets in text nobody edited.
 *
 * Already-generated reports are unaffected either way: `generated_reports`
 * stores rendered `html_content` and the PDF processor renders from that, so
 * only regeneration and new reports from old templates were exposed.
 *
 * This pins existing blocks to the behaviour they were authored under. Blocks
 * that already carry an explicit `markdown` value are left alone, so re-running
 * cannot clobber a deliberate choice.
 */
export class BackfillTextBlockMarkdownOff1790000000000 implements MigrationInterface {
  name = 'BackfillTextBlockMarkdownOff1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "report_templates" AS t
      SET "sections" = rebuilt.sections
      FROM (
        SELECT
          id,
          jsonb_agg(
            CASE
              WHEN section->>'type' = 'text_block'
                   AND NOT (COALESCE(section->'config', '{}'::jsonb) ? 'markdown')
              THEN jsonb_set(
                     section,
                     '{config}',
                     COALESCE(section->'config', '{}'::jsonb) || '{"markdown": false}'::jsonb,
                     true
                   )
              ELSE section
            END
            ORDER BY ordinality
          ) AS sections
        FROM "report_templates",
             LATERAL jsonb_array_elements("sections") WITH ORDINALITY AS a(section, ordinality)
        WHERE jsonb_typeof("sections") = 'array'
        GROUP BY id
      ) AS rebuilt
      WHERE t.id = rebuilt.id
        AND t."sections" IS DISTINCT FROM rebuilt.sections
    `);
  }

  public async down(): Promise<void> {
    // Deliberately not reversible. Removing the flag again would re-expose the
    // silent re-render this migration exists to prevent, and it cannot tell a
    // backfilled `false` from one an author chose.
  }
}
