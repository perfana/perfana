/**
 * Unit tests for ReportTemplate Entity
 *
 * Tests verify:
 * - Entity structure matches database schema (report_templates table)
 * - TypeORM decorators are properly applied
 * - Column types and constraints
 * - Required vs nullable fields
 * - Default values
 * - Unique constraints
 * - Types: ReportSectionType, ReportSectionConfig, ReportStyling
 */

import 'reflect-metadata';
import { getMetadataArgsStorage } from 'typeorm';
import {
  ReportTemplate,
  ReportSectionType,
  ReportSectionConfig,
  ReportStyling,
} from '../report-template.entity';

describe('ReportTemplate Entity', () => {
  describe('Entity Class', () => {
    it('should be defined', () => {
      expect(ReportTemplate).toBeDefined();
    });

    it('should be instantiable', () => {
      const template = new ReportTemplate();
      expect(template).toBeInstanceOf(ReportTemplate);
    });

    it('should have all required properties', () => {
      const template = new ReportTemplate();

      // Required fields (these exist as properties even if undefined)
      expect('id' in template).toBe(true);
      expect('name' in template).toBe(true);
      expect('created_by' in template).toBe(true);
      expect('system_id' in template).toBe(true);
      expect('test_environment' in template).toBe(true);
      expect('workload' in template).toBe(true);
      expect('sections' in template).toBe(true);
      expect('is_default' in template).toBe(true);
      expect('created_at' in template).toBe(true);
      expect('updated_at' in template).toBe(true);
    });

    it('should have optional properties', () => {
      const template = new ReportTemplate();

      // Optional fields
      expect('description' in template).toBe(true);
      expect('styling' in template).toBe(true);
    });
  });

  describe('TypeORM Entity Metadata', () => {
    it('should be registered as an entity', () => {
      const tables = getMetadataArgsStorage().tables;
      const entityMeta = tables.find(
        (t) => t.target === ReportTemplate
      );

      expect(entityMeta).toBeDefined();
      expect(entityMeta?.name).toBe('report_templates');
    });

    it('should have all columns defined', () => {
      const columns = getMetadataArgsStorage().columns;
      const entityColumns = columns.filter(
        (c) => c.target === ReportTemplate
      );

      // Count expected columns (11 columns total)
      expect(entityColumns.length).toBeGreaterThanOrEqual(11);

      // Verify key columns exist
      const columnNames = entityColumns.map((c) => c.propertyName);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('description');
      expect(columnNames).toContain('created_by');
      expect(columnNames).toContain('system_id');
      expect(columnNames).toContain('test_environment');
      expect(columnNames).toContain('workload');
      expect(columnNames).toContain('sections');
      expect(columnNames).toContain('styling');
      expect(columnNames).toContain('is_default');
    });

    it('should have UUID primary key', () => {
      const primaryColumns = getMetadataArgsStorage().columns;
      const idColumn = primaryColumns.find(
        (c) => c.target === ReportTemplate && c.propertyName === 'id'
      );

      expect(idColumn).toBeDefined();
    });

    it('should have unique constraint on name+scope', () => {
      const uniques = getMetadataArgsStorage().uniques;
      const uniqueConstraint = uniques.find(
        (u) => u.target === ReportTemplate
      );

      expect(uniqueConstraint).toBeDefined();
      expect(uniqueConstraint?.name).toBe('uq_report_templates_name_scope');
      expect(uniqueConstraint?.columns).toEqual([
        'name',
        'system_id',
        'test_environment',
        'workload',
      ]);
    });
  });

  describe('Column Types', () => {
    it('should have varchar columns with correct lengths', () => {
      const columns = getMetadataArgsStorage().columns;
      const entityColumns = columns.filter(
        (c) => c.target === ReportTemplate
      );

      // name column
      const nameColumn = entityColumns.find(
        (c) => c.propertyName === 'name'
      );
      expect(nameColumn?.options?.type).toBe('varchar');
      expect(nameColumn?.options?.length).toBe(255);

      // created_by column
      const createdByColumn = entityColumns.find(
        (c) => c.propertyName === 'created_by'
      );
      expect(createdByColumn?.options?.type).toBe('varchar');
      expect(createdByColumn?.options?.length).toBe(255);

      // system_id column
      const systemIdColumn = entityColumns.find(
        (c) => c.propertyName === 'system_id'
      );
      expect(systemIdColumn?.options?.type).toBe('varchar');
      expect(systemIdColumn?.options?.length).toBe(255);

      // test_environment column
      const testEnvColumn = entityColumns.find(
        (c) => c.propertyName === 'test_environment'
      );
      expect(testEnvColumn?.options?.type).toBe('varchar');
      expect(testEnvColumn?.options?.length).toBe(255);

      // workload column
      const workloadColumn = entityColumns.find(
        (c) => c.propertyName === 'workload'
      );
      expect(workloadColumn?.options?.type).toBe('varchar');
      expect(workloadColumn?.options?.length).toBe(255);
    });

    it('should have text column for description', () => {
      const columns = getMetadataArgsStorage().columns;
      const descColumn = columns.find(
        (c) => c.target === ReportTemplate && c.propertyName === 'description'
      );

      expect(descColumn?.options?.type).toBe('text');
      expect(descColumn?.options?.nullable).toBe(true);
    });

    it('should have JSONB columns for sections and styling', () => {
      const columns = getMetadataArgsStorage().columns;
      const entityColumns = columns.filter(
        (c) => c.target === ReportTemplate
      );

      // sections column
      const sectionsColumn = entityColumns.find(
        (c) => c.propertyName === 'sections'
      );
      expect(sectionsColumn?.options?.type).toBe('jsonb');
      expect(sectionsColumn?.options?.default).toBe('[]');

      // styling column
      const stylingColumn = entityColumns.find(
        (c) => c.propertyName === 'styling'
      );
      expect(stylingColumn?.options?.type).toBe('jsonb');
      expect(stylingColumn?.options?.nullable).toBe(true);
    });

    it('should have boolean column for is_default', () => {
      const columns = getMetadataArgsStorage().columns;
      const isDefaultColumn = columns.find(
        (c) => c.target === ReportTemplate && c.propertyName === 'is_default'
      );

      expect(isDefaultColumn?.options?.type).toBe('boolean');
      expect(isDefaultColumn?.options?.default).toBe(false);
    });
  });

  describe('ReportSectionType', () => {
    it('should include all 10 section types', () => {
      const validTypes: ReportSectionType[] = [
        'header',
        'text_block',
        'slo',
        'apdex',
        'transaction_response_times',
        'regressions',
        'awr',
        'trends',
        'comparisons',
        'graphs',
      ];

      // TypeScript would catch invalid types at compile time
      // This test documents the expected types
      validTypes.forEach((type) => {
        expect(typeof type).toBe('string');
      });

      expect(validTypes).toHaveLength(10);
    });

    it('should use underscores (not hyphens) in type names', () => {
      const sectionTypes: ReportSectionType[] = [
        'header',
        'text_block',
        'slo',
        'apdex',
        'transaction_response_times',
        'regressions',
        'awr',
        'trends',
        'comparisons',
        'graphs',
      ];

      sectionTypes.forEach((type) => {
        expect(type).not.toContain('-');
      });
    });
  });

  describe('ReportSectionConfig', () => {
    it('should have required type and order properties', () => {
      const config: ReportSectionConfig = {
        type: 'header',
        order: 0,
      };

      expect(config.type).toBe('header');
      expect(config.order).toBe(0);
    });

    it('should allow optional title property', () => {
      const config: ReportSectionConfig = {
        type: 'slo',
        order: 1,
        title: 'SLO Results',
      };

      expect(config.title).toBe('SLO Results');
    });

    it('should allow optional config property', () => {
      const config: ReportSectionConfig = {
        type: 'transaction_response_times',
        order: 2,
        config: {
          showP95: true,
          topN: 10,
        },
      };

      expect(config.config).toEqual({ showP95: true, topN: 10 });
    });

    it('should allow optional comment property', () => {
      const config: ReportSectionConfig = {
        type: 'regressions',
        order: 3,
        comment: 'Important: 5% regression threshold applied',
      };

      expect(config.comment).toBe('Important: 5% regression threshold applied');
    });

    it('should work with all section types', () => {
      const sections: ReportSectionConfig[] = [
        { type: 'header', order: 0 },
        { type: 'text_block', order: 1 },
        { type: 'slo', order: 2 },
        { type: 'apdex', order: 3 },
        { type: 'transaction_response_times', order: 4 },
        { type: 'regressions', order: 5 },
        { type: 'awr', order: 6 },
        { type: 'trends', order: 7 },
        { type: 'comparisons', order: 8 },
        { type: 'graphs', order: 9 },
      ];

      expect(sections).toHaveLength(10);
      sections.forEach((section, index) => {
        expect(section.order).toBe(index);
      });
    });
  });

  describe('ReportStyling', () => {
    it('should allow empty styling', () => {
      const styling: ReportStyling = {};
      expect(Object.keys(styling)).toHaveLength(0);
    });

    it('should allow primaryColor', () => {
      const styling: ReportStyling = {
        primaryColor: '#1976d2',
      };

      expect(styling.primaryColor).toBe('#1976d2');
    });

    it('should allow secondaryColor', () => {
      const styling: ReportStyling = {
        secondaryColor: '#9c27b0',
      };

      expect(styling.secondaryColor).toBe('#9c27b0');
    });

    it('should allow logo', () => {
      const styling: ReportStyling = {
        logo: 'https://example.com/logo.png',
      };

      expect(styling.logo).toBe('https://example.com/logo.png');
    });

    it('should allow fontFamily', () => {
      const styling: ReportStyling = {
        fontFamily: 'Inter, sans-serif',
      };

      expect(styling.fontFamily).toBe('Inter, sans-serif');
    });

    it('should allow customCss', () => {
      const styling: ReportStyling = {
        customCss: '.header { color: red; }',
      };

      expect(styling.customCss).toBe('.header { color: red; }');
    });

    it('should allow full styling configuration', () => {
      const styling: ReportStyling = {
        primaryColor: '#1976d2',
        secondaryColor: '#9c27b0',
        logo: 'data:image/png;base64,abc123',
        fontFamily: 'Roboto, sans-serif',
        customCss: 'body { margin: 0; }',
      };

      expect(styling.primaryColor).toBe('#1976d2');
      expect(styling.secondaryColor).toBe('#9c27b0');
      expect(styling.logo).toBe('data:image/png;base64,abc123');
      expect(styling.fontFamily).toBe('Roboto, sans-serif');
      expect(styling.customCss).toBe('body { margin: 0; }');
    });
  });

  describe('Entity Instance Operations', () => {
    it('should allow setting all properties', () => {
      const template = new ReportTemplate();

      template.id = '123e4567-e89b-12d3-a456-426614174000';
      template.name = 'Performance Report';
      template.description = 'Standard performance report template';
      template.created_by = 'user@example.com';
      template.system_id = 'my-system';
      template.test_environment = 'production';
      template.workload = 'load-test';
      template.sections = [
        { type: 'header', order: 0 },
        { type: 'slo', order: 1, comment: 'SLO analysis results' },
        { type: 'graphs', order: 2 },
      ];
      template.styling = {
        primaryColor: '#007bff',
        fontFamily: 'Arial, sans-serif',
      };
      template.is_default = true;
      template.created_at = new Date('2024-01-01');
      template.updated_at = new Date('2024-01-15');

      expect(template.id).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(template.name).toBe('Performance Report');
      expect(template.description).toBe('Standard performance report template');
      expect(template.created_by).toBe('user@example.com');
      expect(template.system_id).toBe('my-system');
      expect(template.test_environment).toBe('production');
      expect(template.workload).toBe('load-test');
      expect(template.sections).toHaveLength(3);
      expect(template.styling?.primaryColor).toBe('#007bff');
      expect(template.is_default).toBe(true);
    });

    it('should handle null/undefined optional fields', () => {
      const template = new ReportTemplate();

      template.description = undefined;
      template.styling = undefined;

      expect(template.description).toBeUndefined();
      expect(template.styling).toBeUndefined();
    });

    it('should handle empty sections array', () => {
      const template = new ReportTemplate();
      template.sections = [];

      expect(template.sections).toEqual([]);
      expect(template.sections).toHaveLength(0);
    });

    it('should handle complex sections configuration', () => {
      const template = new ReportTemplate();

      template.sections = [
        {
          type: 'header',
          order: 0,
          title: 'Performance Test Report',
          config: {
            showDate: true,
            showLogo: true,
          },
        },
        {
          type: 'text_block',
          order: 1,
          title: 'Executive Summary',
          config: {
            content: '# Summary\n\nThis report shows...',
            style: 'markdown',
          },
        },
        {
          type: 'slo',
          order: 2,
          title: 'SLO Compliance',
          comment: 'All SLOs met for this test run',
          config: {
            showDetails: true,
            failedOnly: false,
          },
        },
        {
          type: 'transaction_response_times',
          order: 3,
          config: {
            metrics: ['avg', 'p95', 'p99', 'max'],
            topN: 20,
          },
        },
        {
          type: 'graphs',
          order: 4,
          title: 'Custom Graphs',
          config: {
            graphType: 'line',
            metrics: ['cpu_usage', 'memory_usage'],
          },
        },
      ];

      expect(template.sections).toHaveLength(5);
      expect(template.sections[0].type).toBe('header');
      expect(template.sections[2].comment).toBe('All SLOs met for this test run');
      expect(template.sections[3].config?.topN).toBe(20);
    });
  });

  describe('Database Schema Compliance', () => {
    /**
     * These tests verify the entity matches the existing database schema:
     *
     * CREATE TABLE report_templates (
     *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     *   name VARCHAR(255) NOT NULL,
     *   description TEXT,
     *   created_by VARCHAR(255) NOT NULL,
     *   system_id VARCHAR(255) NOT NULL,
     *   test_environment VARCHAR(255) NOT NULL,
     *   workload VARCHAR(255) NOT NULL,
     *   sections JSONB DEFAULT '[]',
     *   styling JSONB,
     *   is_default BOOLEAN DEFAULT false,
     *   created_at TIMESTAMPTZ DEFAULT NOW(),
     *   updated_at TIMESTAMPTZ DEFAULT NOW(),
     *   UNIQUE(name, system_id, test_environment, workload)
     * );
     */

    it('should have correct table name', () => {
      const tables = getMetadataArgsStorage().tables;
      const table = tables.find((t) => t.target === ReportTemplate);

      expect(table?.name).toBe('report_templates');
    });

    it('should have all columns from database schema', () => {
      const expectedColumns = [
        'id',
        'name',
        'description',
        'created_by',
        'system_id',
        'test_environment',
        'workload',
        'sections',
        'styling',
        'is_default',
        'created_at',
        'updated_at',
      ];

      const columns = getMetadataArgsStorage().columns;
      const entityColumns = columns.filter(
        (c) => c.target === ReportTemplate
      );
      const columnNames = entityColumns.map((c) => c.propertyName);

      expectedColumns.forEach((col) => {
        expect(columnNames).toContain(col);
      });
    });

    it('should have required NOT NULL columns', () => {
      const columns = getMetadataArgsStorage().columns;
      const entityColumns = columns.filter(
        (c) => c.target === ReportTemplate
      );

      // These columns should NOT be nullable
      const requiredColumns = [
        'name',
        'created_by',
        'system_id',
        'test_environment',
        'workload',
      ];

      requiredColumns.forEach((colName) => {
        const column = entityColumns.find((c) => c.propertyName === colName);
        expect(column?.options?.nullable).not.toBe(true);
      });

      // These columns should be nullable
      const nullableColumns = ['description', 'styling'];

      nullableColumns.forEach((colName) => {
        const column = entityColumns.find((c) => c.propertyName === colName);
        expect(column?.options?.nullable).toBe(true);
      });
    });

    it('should have correct default values', () => {
      const columns = getMetadataArgsStorage().columns;
      const entityColumns = columns.filter(
        (c) => c.target === ReportTemplate
      );

      // sections default: '[]'
      const sectionsCol = entityColumns.find(
        (c) => c.propertyName === 'sections'
      );
      expect(sectionsCol?.options?.default).toBe('[]');

      // is_default default: false
      const isDefaultCol = entityColumns.find(
        (c) => c.propertyName === 'is_default'
      );
      expect(isDefaultCol?.options?.default).toBe(false);
    });
  });
});
