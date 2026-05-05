const { RuleTester } = require('eslint');
const rule = require('./owned-resource-must-use-request-em');

const ruleTester = new RuleTester({
  parser: require.resolve('@typescript-eslint/parser'),
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

// Filenames are outside the allowlist so the rule is not grandfathered. The
// allowlist file resolution walks parent dirs from the test file path; using
// /tmp/... never resolves to a real allowlist, so allowlist is treated as empty.
const OUTSIDE_ALLOWLIST = '/tmp/test/svc.ts';

ruleTester.run('owned-resource-must-use-request-em', rule, {
  valid: [
    {
      name: 'wrapped call passes',
      filename: OUTSIDE_ALLOWLIST,
      code: `
        import { Repository } from 'typeorm';
        import { InjectRepository } from '@nestjs/typeorm';
        class ApiKey {}
        function withRequestEm(r: any) { return r; }
        class Svc {
          constructor(@InjectRepository(ApiKey) private readonly apiKeyRepo: Repository<ApiKey>) {}
          async findAll() {
            return withRequestEm(this.apiKeyRepo).find({});
          }
        }
      `,
    },
    {
      name: 'non-owned repo call passes',
      filename: OUTSIDE_ALLOWLIST,
      code: `
        import { Repository } from 'typeorm';
        import { InjectRepository } from '@nestjs/typeorm';
        class User {}
        class Svc {
          constructor(@InjectRepository(User) private readonly userRepo: Repository<User>) {}
          async findAll() {
            return this.userRepo.find({});
          }
        }
      `,
    },
    {
      name: 'no @InjectRepository — no constraint',
      filename: OUTSIDE_ALLOWLIST,
      code: `
        class Svc {
          someMethod() {
            return (this as any).foo.find({});
          }
        }
      `,
    },
    {
      name: 'aliased entity import — withRequestEm wrap passes',
      filename: OUTSIDE_ALLOWLIST,
      code: `
        import { Repository } from 'typeorm';
        import { InjectRepository } from '@nestjs/typeorm';
        class BenchmarkEntity {}
        function withRequestEm(r: any) { return r; }
        class Svc {
          constructor(@InjectRepository(BenchmarkEntity) private readonly benchmarkRepo: Repository<BenchmarkEntity>) {}
          async findAll() {
            return withRequestEm(this.benchmarkRepo).find({});
          }
        }
      `,
    },
  ],
  invalid: [
    {
      name: 'unwrapped find on owned repo errors',
      filename: OUTSIDE_ALLOWLIST,
      code: `
        import { Repository } from 'typeorm';
        import { InjectRepository } from '@nestjs/typeorm';
        class ApiKey {}
        class Svc {
          constructor(@InjectRepository(ApiKey) private readonly apiKeyRepo: Repository<ApiKey>) {}
          async findAll() {
            return this.apiKeyRepo.find({});
          }
        }
      `,
      errors: [{ messageId: 'mustWrap' }],
    },
    {
      name: 'unwrapped save on owned repo errors',
      filename: OUTSIDE_ALLOWLIST,
      code: `
        import { Repository } from 'typeorm';
        import { InjectRepository } from '@nestjs/typeorm';
        class GrafanaDashboard {}
        class Svc {
          constructor(@InjectRepository(GrafanaDashboard) private readonly dashRepo: Repository<GrafanaDashboard>) {}
          async create(d: any) {
            return this.dashRepo.save(d);
          }
        }
      `,
      errors: [{ messageId: 'mustWrap' }],
    },
    {
      name: 'unwrapped createQueryBuilder on owned repo errors',
      filename: OUTSIDE_ALLOWLIST,
      code: `
        import { Repository } from 'typeorm';
        import { InjectRepository } from '@nestjs/typeorm';
        class TestRun {}
        class Svc {
          constructor(@InjectRepository(TestRun) private readonly testRunRepo: Repository<TestRun>) {}
          async query() {
            return this.testRunRepo.createQueryBuilder('tr').getMany();
          }
        }
      `,
      errors: [{ messageId: 'mustWrap' }],
    },
    {
      name: 'aliased entity name in @InjectRepository — unwrapped errors',
      filename: OUTSIDE_ALLOWLIST,
      code: `
        import { Repository } from 'typeorm';
        import { InjectRepository } from '@nestjs/typeorm';
        class BenchmarkEntity {}
        class Svc {
          constructor(@InjectRepository(BenchmarkEntity) private readonly benchmarkRepo: Repository<BenchmarkEntity>) {}
          async findAll() {
            return this.benchmarkRepo.find({});
          }
        }
      `,
      errors: [{ messageId: 'mustWrap' }],
    },
  ],
});
