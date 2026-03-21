import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Migration to add pdf_data column for storing PDF binary data
 */
export class AddPdfDataColumn1773100000000 implements MigrationInterface {
  name = 'AddPdfDataColumn1773100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'generated_reports',
      new TableColumn({
        name: 'pdf_data',
        type: 'bytea',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('generated_reports', 'pdf_data');
  }
}
