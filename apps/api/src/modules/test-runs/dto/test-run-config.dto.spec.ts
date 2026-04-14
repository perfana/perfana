import { validate } from 'class-validator';
import { plainToClass } from 'class-transformer';
import { 
  AddTestRunConfigDto, 
  AddTestRunConfigsDto, 
  AddTestRunConfigJsonDto, 
  TestRunConfigItemDto 
} from './test-run-config.dto';

describe('TestRunConfig DTOs', () => {
  describe('TestRunConfigItemDto', () => {
    it('should validate a valid config item', async () => {
      const dto = plainToClass(TestRunConfigItemDto, {
        key: 'jvm.heap.size',
        value: '2048m'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid config item with missing key', async () => {
      const dto = plainToClass(TestRunConfigItemDto, {
        value: '2048m'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('key');
    });

    it('should reject invalid config item with missing value', async () => {
      const dto = plainToClass(TestRunConfigItemDto, {
        key: 'jvm.heap.size'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('value');
    });

    it('should reject non-string key', async () => {
      const dto = plainToClass(TestRunConfigItemDto, {
        key: 123,
        value: '2048m'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('key');
    });

    it('should reject non-string value', async () => {
      const dto = plainToClass(TestRunConfigItemDto, {
        key: 'jvm.heap.size',
        value: 2048
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('value');
    });
  });

  describe('AddTestRunConfigDto', () => {
    const validDto = {
      systemUnderTest: 'my-app',
      testEnvironment: 'production',
      workload: 'load-test',
      testRunId: 'load-test-2024-01-15-14-30',
      tags: ['performance', 'production'],
      key: 'jvm.heap.size',
      value: '2048m'
    };

    it('should validate a valid single config DTO', async () => {
      const dto = plainToClass(AddTestRunConfigDto, validDto);

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should reject missing systemUnderTest', async () => {
      const dto = plainToClass(AddTestRunConfigDto, {
        ...validDto,
        systemUnderTest: undefined
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('systemUnderTest');
    });

    it('should reject invalid tags (non-array)', async () => {
      const dto = plainToClass(AddTestRunConfigDto, {
        ...validDto,
        tags: 'not-an-array'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('tags');
    });

    it('should reject invalid tags (non-string elements)', async () => {
      const dto = plainToClass(AddTestRunConfigDto, {
        ...validDto,
        tags: ['performance', 123]
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('tags');
    });
  });

  describe('AddTestRunConfigsDto', () => {
    const validDto = {
      systemUnderTest: 'my-app',
      testEnvironment: 'production',
      workload: 'load-test',
      testRunId: 'load-test-2024-01-15-14-30',
      tags: ['performance', 'production'],
      configItems: [
        { key: 'jvm.heap.size', value: '2048m' },
        { key: 'database.pool.size', value: '50' }
      ]
    };

    it('should validate a valid multiple configs DTO', async () => {
      const dto = plainToClass(AddTestRunConfigsDto, validDto);

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should reject empty configItems array', async () => {
      const dto = plainToClass(AddTestRunConfigsDto, {
        ...validDto,
        configItems: []
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('configItems');
    });

    it('should reject invalid configItems (not an array)', async () => {
      const dto = plainToClass(AddTestRunConfigsDto, {
        ...validDto,
        configItems: 'not-an-array'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('configItems');
    });

    it('should reject configItems with invalid structure', async () => {
      const dto = plainToClass(AddTestRunConfigsDto, {
        ...validDto,
        configItems: [
          { key: 'jvm.heap.size' }, // missing value
          { value: '50' } // missing key
        ]
      });

      const errors = await validate(dto);
      // Check if there are validation errors in nested objects
      const hasNestedErrors = errors.some(error => 
        error.children && error.children.length > 0
      );
      expect(errors.length > 0 || hasNestedErrors).toBe(true);
    });
  });

  describe('AddTestRunConfigJsonDto', () => {
    const validDto = {
      systemUnderTest: 'my-app',
      testEnvironment: 'production',
      workload: 'load-test',
      testRunId: 'load-test-2024-01-15-14-30',
      tags: ['performance', 'production'],
      includes: ['jvm\\..*', 'database\\..*'],
      excludes: ['.*\\.password', '.*\\.secret'],
      json: {
        jvm: {
          heap: { size: '2048m', type: 'G1GC' },
          gc: { threads: 4 }
        },
        database: {
          pool: { size: 50, timeout: 30 }
        }
      }
    };

    it('should validate a valid JSON config DTO', async () => {
      const dto = plainToClass(AddTestRunConfigJsonDto, validDto);

      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('should reject missing includes', async () => {
      const dto = plainToClass(AddTestRunConfigJsonDto, {
        ...validDto,
        includes: undefined
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('includes');
    });

    it('should reject missing excludes', async () => {
      const dto = plainToClass(AddTestRunConfigJsonDto, {
        ...validDto,
        excludes: undefined
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('excludes');
    });

    it('should reject invalid includes (non-array)', async () => {
      const dto = plainToClass(AddTestRunConfigJsonDto, {
        ...validDto,
        includes: 'not-an-array'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('includes');
    });

    it('should reject invalid excludes (non-string elements)', async () => {
      const dto = plainToClass(AddTestRunConfigJsonDto, {
        ...validDto,
        excludes: ['.*\\.password', 123]
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('excludes');
    });

    it('should reject missing json object', async () => {
      const dto = plainToClass(AddTestRunConfigJsonDto, {
        ...validDto,
        json: undefined
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('json');
    });

    it('should reject non-object json', async () => {
      const dto = plainToClass(AddTestRunConfigJsonDto, {
        ...validDto,
        json: 'not-an-object'
      });

      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.property).toBe('json');
    });
  });
});