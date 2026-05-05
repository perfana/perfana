const fs = require('fs');
const path = require('path');

let cache = null;

function findRepoRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'apps/api/.rls-em-migration-allowlist.json');
    if (fs.existsSync(candidate)) return { allowlistPath: candidate, repoRoot: dir };
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadCache(cwd) {
  if (cache !== null) return cache;
  try {
    const found = findRepoRoot(cwd);
    if (!found) {
      cache = { allowlist: new Set(), repoRoot: cwd };
    } else {
      const entries = JSON.parse(fs.readFileSync(found.allowlistPath, 'utf8'));
      cache = { allowlist: new Set(entries), repoRoot: found.repoRoot };
    }
  } catch {
    cache = { allowlist: new Set(), repoRoot: cwd };
  }
  return cache;
}

// Owned-resource entity class names (the 26 entities with NOT NULL
// organization_id per Phase 4). Used to detect @InjectRepository(<Entity>)
// declarations. Includes the local-import-alias forms (`Benchmark as
// BenchmarkEntity`) actually used in the codebase, so the rule can match
// either `@InjectRepository(Benchmark)` or `@InjectRepository(BenchmarkEntity)`.
//
// Maintained alongside .rls-em-migration-allowlist.json — adding a new owned
// entity requires adding its class name (and any common aliases) here too.
const OWNED_RESOURCE_ENTITIES = new Set([
  'AlertTagFilter',
  'ApiKey',
  'ApplicationDashboard',
  'ApplicationDashboardEntity',
  'Benchmark',
  'BenchmarkEntity',
  'CompareFilterPreset',
  'DeepLink',
  'DeepLinkEntity',
  'DynatraceConfig',
  'DynatraceEntityMapping',
  'DynatraceQuery',
  'ExpectedConfigChange',
  'GenericDeepLink',
  'GenericDeepLinkEntity',
  'GrafanaDashboard',
  'GrafanaDashboardEntity',
  'GrafanaInstance',
  'GrafanaInstanceEntity',
  'GraphPreset',
  'MetricsSource',
  'MetricsSourceEntity',
  'NotificationChannel',
  'Profile',
  'ProfileBenchmark',
  'ProfileGrafanaDashboard',
  'PyroscopeInstance',
  'PyroscopeInstanceEntity',
  'ReportTemplate',
  'SparseMetricExclusion',
  'SystemUnderTest',
  'SystemUnderTestEntity',
  'TestRun',
  'TestRunEntity',
  'TracingInstance',
  'TracingInstanceEntity',
  'TracingService',
  'TrendsFilterPreset',
]);

const REPO_METHODS = new Set([
  'find', 'findOne', 'findBy', 'findOneBy', 'findOneOrFail', 'findOneByOrFail',
  'findAndCount', 'findAndCountBy',
  'save', 'remove', 'softRemove', 'recover',
  'insert', 'update', 'upsert', 'delete', 'softDelete',
  'count', 'countBy', 'sum', 'average', 'minimum', 'maximum',
  'increment', 'decrement',
  'createQueryBuilder',
]);

function relativizePath(filename, repoRoot) {
  if (!filename || !repoRoot) return filename;
  const rel = path.relative(repoRoot, filename);
  return rel.split(path.sep).join('/');
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Owned-resource repository calls must be wrapped with withRequestEm() so ' +
        'they participate in the RlsTransactionInterceptor transaction (Phase 5b). ' +
        'Files listed in apps/api/.rls-em-migration-allowlist.json are grandfathered.',
    },
    schema: [],
    messages: {
      mustWrap:
        'Owned-resource repository call `{{access}}.{{method}}(...)` must be wrapped ' +
        'with `withRequestEm()`. See: docs/superpowers/audits/2026-05-04-rls-decisions.md',
    },
  },
  create(context) {
    const filename = context.getFilename();
    const cwd = context.getCwd ? context.getCwd() : path.dirname(filename);
    const { allowlist, repoRoot } = loadCache(cwd);
    const relPath = relativizePath(filename, repoRoot);
    if (allowlist.has(relPath)) return {};

    // Collect repo property names that are owned-resource repos based on the
    // class's @InjectRepository declarations. The constructor params will look
    // like:
    //   constructor(
    //     @InjectRepository(ApiKey) private readonly apiKeyRepo: Repository<ApiKey>,
    //   )
    const ownedRepoNames = new Set();

    function recordOwnedRepoFromDecorator(node) {
      const expr = node.expression;
      if (!expr || expr.type !== 'CallExpression') return;
      if (expr.callee.type !== 'Identifier' || expr.callee.name !== 'InjectRepository') return;
      const arg = expr.arguments[0];
      if (!arg || arg.type !== 'Identifier') return;
      if (!OWNED_RESOURCE_ENTITIES.has(arg.name)) return;
      // Walk up to the parameter to grab the property name.
      let p = node.parent;
      while (p && p.type !== 'TSParameterProperty' && p.type !== 'Identifier') p = p.parent;
      if (!p) return;
      const ident = p.type === 'TSParameterProperty' ? p.parameter : p;
      if (ident && ident.type === 'Identifier') {
        ownedRepoNames.add(ident.name);
      }
    }

    return {
      Decorator: recordOwnedRepoFromDecorator,
      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression') return;
        const propNode = node.callee.property;
        if (propNode.type !== 'Identifier') return;
        if (!REPO_METHODS.has(propNode.name)) return;

        const obj = node.callee.object;
        if (obj.type !== 'MemberExpression') return;
        if (obj.object.type !== 'ThisExpression') return;
        if (obj.property.type !== 'Identifier') return;

        const repoName = obj.property.name;
        if (!ownedRepoNames.has(repoName)) return;

        context.report({
          node,
          messageId: 'mustWrap',
          data: { access: `this.${repoName}`, method: propNode.name },
        });
      },
    };
  },
};
