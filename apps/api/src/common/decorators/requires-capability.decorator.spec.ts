import 'reflect-metadata';
import { REQUIRES_CAPABILITY_META, RequiresCapability, RequiresCapabilityMeta } from './requires-capability.decorator';
import { Capability } from '../../constants/capabilities.constants';

describe('RequiresCapability decorator', () => {
  /**
   * Helper: apply the decorator to a class method and retrieve the metadata
   * that Reflect (via NestJS SetMetadata) stored on it.
   *
   * NestJS's SetMetadata stores metadata directly on `descriptor.value` (the
   * method function) when a descriptor is present, so we must read it back via
   * `Reflect.getMetadata(key, methodFn)` — not `(target, propertyKey)`.
   */
  function applyAndRead(
    ...args: Parameters<typeof RequiresCapability>
  ): RequiresCapabilityMeta | undefined {
    class Target {
      testMethod() { /* intentionally empty — decorator target only */ }
    }

    const propertyKey = 'testMethod';
    const descriptor = Object.getOwnPropertyDescriptor(Target.prototype, propertyKey)!;

    const decorator = RequiresCapability(...args);
    decorator(Target.prototype, propertyKey, descriptor);

    // SetMetadata stores on descriptor.value (the function itself)
    return Reflect.getMetadata(REQUIRES_CAPABILITY_META, descriptor.value) as
      | RequiresCapabilityMeta
      | undefined;
  }

  it('stores the capability constant on the method metadata key', () => {
    const meta = applyAndRead(Capability.IntegrationDynatraceUpdate);

    expect(meta).toBeDefined();
    expect(meta!.capability).toBe('integration:dynatrace:update');
  });

  it('stores the OrgIdSource config when provided', () => {
    const meta = applyAndRead(Capability.IntegrationDynatraceUpdate, {
      orgIdFromBody: 'organizationId',
    });

    expect(meta!.source).toEqual({ orgIdFromBody: 'organizationId' });
  });

  it('defaults to an empty source object when no config is passed (system-level capability)', () => {
    const meta = applyAndRead(Capability.SystemManageUsers);

    expect(meta!.source).toEqual({});
  });

  it('stores orgIdParam source config', () => {
    const meta = applyAndRead(Capability.IntegrationGrafanaUpdate, {
      orgIdParam: 'id',
    });

    expect(meta!.source).toEqual({ orgIdParam: 'id' });
  });

  it('stores orgIdFromQuery source config', () => {
    const meta = applyAndRead(Capability.TestRunDelete, {
      orgIdFromQuery: 'orgId',
    });

    expect(meta!.source).toEqual({ orgIdFromQuery: 'orgId' });
  });
});
