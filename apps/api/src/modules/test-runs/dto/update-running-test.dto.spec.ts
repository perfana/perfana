import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { 
  UpdateRunningTestDto, 
  VariableDto, 
  DeepLinkDto 
} from './update-running-test.dto';

describe('TestRuns DTOs', () => {
  describe('VariableDto', () => {
    it('should validate a valid variable', async () => {
      const dto = plainToClass(VariableDto, {
        placeholder: 'heap.size',
        value: '2048m'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should reject missing placeholder', async () => {
      const dto = plainToClass(VariableDto, {
        value: '2048m'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('placeholder');
    });

    it('should reject missing value', async () => {
      const dto = plainToClass(VariableDto, {
        placeholder: 'heap.size'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('value');
    });

    it('should reject non-string placeholder', async () => {
      const dto = plainToClass(VariableDto, {
        placeholder: 123,
        value: '2048m'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('placeholder');
    });

    it('should reject non-string value', async () => {
      const dto = plainToClass(VariableDto, {
        placeholder: 'heap.size',
        value: 2048
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('value');
    });
  });

  describe('DeepLinkDto', () => {
    it('should validate a valid deep link', async () => {
      const dto = plainToClass(DeepLinkDto, {
        name: 'Grafana Dashboard',
        url: 'https://grafana.example.com/dashboard/123'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should reject missing name', async () => {
      const dto = plainToClass(DeepLinkDto, {
        url: 'https://grafana.example.com/dashboard/123'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('name');
    });

    it('should reject missing url', async () => {
      const dto = plainToClass(DeepLinkDto, {
        name: 'Grafana Dashboard'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('url');
    });

    it('should reject non-string name', async () => {
      const dto = plainToClass(DeepLinkDto, {
        name: 123,
        url: 'https://grafana.example.com/dashboard/123'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('name');
    });

    it('should reject non-string url', async () => {
      const dto = plainToClass(DeepLinkDto, {
        name: 'Grafana Dashboard',
        url: 12345
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('url');
    });
  });

  describe('UpdateRunningTestDto', () => {
    const validDto = {
      systemUnderTest: 'ecommerce-api',
      workload: 'load-test',
      testEnvironment: 'production',
      testRunId: 'load-test-2024-01-15-14-30-001',
      completed: false,
      version: '1.2.3',
      start: '2024-01-15T14:30:00.000Z',
      end: '2024-01-15T15:00:00.000Z',
      duration: '1800',
      rampUp: '300',
      CIBuildResultsUrl: 'https://jenkins.example.com/build/123',
      annotations: 'Performance baseline test',
      abort: false,
      abortMessage: '',
      tags: ['performance', 'baseline'],
      variables: [
        { placeholder: 'heap.size', value: '2048m' },
        { placeholder: 'thread.count', value: '10' }
      ],
      deepLinks: [
        { name: 'Grafana Dashboard', url: 'https://grafana.example.com/dashboard/123' },
        { name: 'Application Logs', url: 'https://logs.example.com/app/123' }
      ]
    };

    it('should validate a complete valid DTO', async () => {
      const dto = plainToClass(UpdateRunningTestDto, validDto);

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should validate a minimal valid DTO', async () => {
      const minimalDto = {
        systemUnderTest: 'ecommerce-api',
        workload: 'load-test',
        testEnvironment: 'production',
        testRunId: 'load-test-2024-01-15-14-30-001',
        completed: false
      };

      const dto = plainToClass(UpdateRunningTestDto, minimalDto);

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    // Test required fields
    describe('Required fields validation', () => {
      const requiredFields = ['systemUnderTest', 'workload', 'testEnvironment', 'testRunId', 'completed'];

      requiredFields.forEach(field => {
        it(`should reject missing ${field}`, async () => {
          const invalidDto = { ...validDto };
          delete (invalidDto as any)[field];

          const dto = plainToClass(UpdateRunningTestDto, invalidDto);
          const errors = await validate(dto);
          
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some(error => error.property === field)).toBe(true);
        });
      });

      it('should reject non-string systemUnderTest', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          systemUnderTest: 123
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(1);
        expect(errors[0]?.property).toBe('systemUnderTest');
      });

      it('should reject non-string workload', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          workload: true
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(1);
        expect(errors[0]?.property).toBe('workload');
      });

      it('should reject non-string testEnvironment', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          testEnvironment: []
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(1);
        expect(errors[0]?.property).toBe('testEnvironment');
      });

      it('should reject non-string testRunId', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          testRunId: 12345
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(1);
        expect(errors[0]?.property).toBe('testRunId');
      });

      it('should reject non-boolean completed', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          completed: 'true'
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(1);
        expect(errors[0]?.property).toBe('completed');
      });
    });

    // Test optional fields
    describe('Optional fields validation', () => {
      it('should validate optional string fields', async () => {
        // Note: 'duration' and 'rampUp' accept both string and number via @Transform
        // So we exclude them from this string-only validation test
        const stringFields = ['version', 'start', 'end', 'CIBuildResultsUrl', 'annotations', 'abortMessage'];

        for (const field of stringFields) {
          const dtoWithInvalidField = { ...validDto };
          (dtoWithInvalidField as any)[field] = 123; // Should be string

          const dto = plainToClass(UpdateRunningTestDto, dtoWithInvalidField);
          const errors = await validate(dto);

          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some(error => error.property === field)).toBe(true);
        }
      });

      it('should validate optional boolean fields', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          abort: 'false' // Should be boolean
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(1);
        expect(errors[0]?.property).toBe('abort');
      });

      it('should allow undefined optional fields', async () => {
        const dtoWithoutOptionals = {
          systemUnderTest: 'ecommerce-api',
          workload: 'load-test',
          testEnvironment: 'production',
          testRunId: 'load-test-2024-01-15-14-30-001',
          completed: false
        };

        const dto = plainToClass(UpdateRunningTestDto, dtoWithoutOptionals);
        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });
    });

    // Test array fields
    describe('Array fields validation', () => {
      it('should validate tags array with strings', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          tags: ['performance', 'baseline', 'production']
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });

      it('should reject tags array with non-strings', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          tags: ['performance', 123, 'production']
        });

        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.some(error => error.property === 'tags')).toBe(true);
      });

      it('should transform comma-separated string tags to array', async () => {
        // The DTO has a @Transform decorator that converts comma-separated strings to arrays
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          tags: 'tag1,tag2,tag3'
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
        expect(dto.tags).toEqual(['tag1', 'tag2', 'tag3']);
      });

      it('should validate variables array', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          variables: [
            { placeholder: 'heap.size', value: '2048m' },
            { placeholder: 'thread.count', value: '10' }
          ]
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });

      it('should reject invalid variables array items', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          variables: [
            { placeholder: 'heap.size', value: '2048m' },
            { placeholder: 'thread.count' } // missing value
          ]
        });

        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        // Check if there are nested validation errors
        const hasNestedErrors = errors.some(error => 
          error.property === 'variables' && error.children && error.children.length > 0
        );
        expect(hasNestedErrors).toBe(true);
      });

      it('should validate deepLinks array', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          deepLinks: [
            { name: 'Grafana Dashboard', url: 'https://grafana.example.com/dashboard/123' },
            { name: 'Application Logs', url: 'https://logs.example.com/app/123' }
          ]
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });

      it('should reject invalid deepLinks array items', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          deepLinks: [
            { name: 'Grafana Dashboard', url: 'https://grafana.example.com/dashboard/123' },
            { name: 'Application Logs' } // missing url
          ]
        });

        const errors = await validate(dto);
        expect(errors.length).toBeGreaterThan(0);
        // Check if there are nested validation errors
        const hasNestedErrors = errors.some(error => 
          error.property === 'deepLinks' && error.children && error.children.length > 0
        );
        expect(hasNestedErrors).toBe(true);
      });

      it('should allow empty arrays', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          tags: [],
          variables: [],
          deepLinks: []
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });
    });

    // Test edge cases
    describe('Edge cases', () => {
      it('should handle ISO date strings', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          start: '2024-01-15T14:30:00.000Z',
          end: '2024-01-15T15:00:00.000Z'
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });

      it('should handle numeric strings for duration fields', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          duration: '1800',
          rampUp: '300'
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });

      it('should handle URL strings', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          CIBuildResultsUrl: 'https://jenkins.example.com/build/123/results'
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });

      it('should handle completed test with end time', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          completed: true,
          end: '2024-01-15T15:00:00.000Z'
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });

      it('should handle aborted test', async () => {
        const dto = plainToClass(UpdateRunningTestDto, {
          ...validDto,
          completed: false,
          abort: true,
          abortMessage: 'Test was manually aborted due to system issues'
        });

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });
    });

    // Test transformation
    describe('Class transformation', () => {
      it('should properly transform nested objects', async () => {
        const plainObject = {
          ...validDto,
          variables: [
            { placeholder: 'heap.size', value: '2048m' },
            { placeholder: 'thread.count', value: '10' }
          ],
          deepLinks: [
            { name: 'Grafana Dashboard', url: 'https://grafana.example.com/dashboard/123' }
          ]
        };

        const dto = plainToClass(UpdateRunningTestDto, plainObject);

        expect(dto.variables).toBeDefined();
        expect(dto.variables![0]).toBeInstanceOf(VariableDto);
        expect(dto.deepLinks).toBeDefined();
        expect(dto.deepLinks![0]).toBeInstanceOf(DeepLinkDto);

        const errors = await validate(dto);
        expect(errors).toHaveLength(0);
      });
    });
  });
});