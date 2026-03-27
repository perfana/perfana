/**
 * Dashboard UID Generation Tests
 *
 * Tests the critical UID generation logic for both readOnly and writable dashboards
 */

import {
  DashboardUid,
  createDashboardUid,
  AutoConfigDashboard,
} from './dashboard-uid.util';
import { DashboardVariable } from './types';

describe('DashboardUid', () => {
  describe('fromString (readOnly mode)', () => {
    it('should create dashboard UID without hashing', () => {
      const uid = DashboardUid.fromString('my-dashboard-uid');

      expect(uid.dashboardUid).toBe('my-dashboard-uid');
      expect(uid.dashboardUidInput).toBe('my-dashboard-uid');
    });

    it('should preserve template UIDs exactly', () => {
      const templateUid = 'perfana-gatling-overview';
      const uid = DashboardUid.fromString(templateUid);

      expect(uid.dashboardUid).toBe(templateUid);
    });
  });

  describe('fromHashedString (writable mode)', () => {
    it('should create MD5 hashed dashboard UID', () => {
      const input = 'my-system-test-production-grafana-instance-template-uid';
      const uid = DashboardUid.fromHashedString(input);

      expect(uid.dashboardUidInput).toBe(input);
      expect(uid.dashboardUid).not.toBe(input);
      expect(uid.dashboardUid).toMatch(/^[a-f0-9]{32}$/); // MD5 hash format
    });

    it('should produce consistent hashes for same input', () => {
      const input = 'test-input';
      const uid1 = DashboardUid.fromHashedString(input);
      const uid2 = DashboardUid.fromHashedString(input);

      expect(uid1.dashboardUid).toBe(uid2.dashboardUid);
    });

    it('should produce different hashes for different inputs', () => {
      const uid1 = DashboardUid.fromHashedString('input1');
      const uid2 = DashboardUid.fromHashedString('input2');

      expect(uid1.dashboardUid).not.toBe(uid2.dashboardUid);
    });
  });

  describe('from (main factory method)', () => {
    const mockTestRun: any = {
      systemUnderTest: { name: 'my-application' },
      testEnvironment: 'production',
      systemUnderTestId: 'sut-id',
    };

    describe('readOnly: true mode', () => {
      it('should use template UID directly without hashing', () => {
        const autoConfigDashboard: AutoConfigDashboard = {
          dashboardUid: 'template-uid-123',
          dashboardName: 'Test Dashboard',
          profile: 'profile1',
          grafanaLabel: 'grafana-instance',
          readOnly: true,
        };

        const result = DashboardUid.from(mockTestRun, autoConfigDashboard);

        expect(result.dashboardUid).toBe('template-uid-123');
        expect(result.dashboardUidInput).toBe('template-uid-123');
      });

      it('should allow duplicate UIDs with different variables (readOnly behavior)', () => {
        const autoConfigDashboard: AutoConfigDashboard = {
          dashboardUid: 'shared-template',
          dashboardName: 'Shared Dashboard',
          profile: 'profile1',
          grafanaLabel: 'grafana-instance',
          readOnly: true,
        };

        const testRun1: any = {
          systemUnderTest: { name: 'app1' },
          testEnvironment: 'prod',
          systemUnderTestId: 'sut-id',
        };

        const testRun2: any = {
          systemUnderTest: { name: 'app2' },
          testEnvironment: 'dev',
          systemUnderTestId: 'sut-id',
        };

        const uid1 = DashboardUid.from(testRun1, autoConfigDashboard);
        const uid2 = DashboardUid.from(testRun2, autoConfigDashboard);

        // Both should use same template UID - this is the readOnly behavior!
        expect(uid1.dashboardUid).toBe('shared-template');
        expect(uid2.dashboardUid).toBe('shared-template');
        expect(uid1.dashboardUid).toBe(uid2.dashboardUid);
      });
    });

    describe('readOnly: false mode (writable dashboards)', () => {
      it('should generate unique MD5 hash based on test run and config', () => {
        const autoConfigDashboard: AutoConfigDashboard = {
          dashboardUid: 'template-uid',
          dashboardName: 'Test Dashboard',
          profile: 'profile1',
          grafanaLabel: 'grafana-instance',
          readOnly: false,
        };

        const result = DashboardUid.from(mockTestRun, autoConfigDashboard);

        expect(result.dashboardUid).not.toBe('template-uid');
        expect(result.dashboardUid).toMatch(/^[a-f0-9]{32}$/);
      });

      it('should use systemUnderTest.name in hash calculation (CRITICAL)', () => {
        const autoConfigDashboard: AutoConfigDashboard = {
          dashboardUid: 'template',
          dashboardName: 'Test',
          profile: 'profile1',
          grafanaLabel: 'grafana1',
          readOnly: false,
        };

        const testRun1: any = {
          systemUnderTest: { name: 'app1' },
          testEnvironment: 'prod',
          systemUnderTestId: 'sut-id',
        };

        const testRun2: any = {
          systemUnderTest: { name: 'app2' },
          testEnvironment: 'prod',
          systemUnderTestId: 'sut-id',
        };

        const uid1 = DashboardUid.from(testRun1, autoConfigDashboard);
        const uid2 = DashboardUid.from(testRun2, autoConfigDashboard);

        // Different systemUnderTest.name should produce different UIDs
        expect(uid1.dashboardUid).not.toBe(uid2.dashboardUid);
      });

      it('should generate different UIDs for different test environments', () => {
        const autoConfigDashboard: AutoConfigDashboard = {
          dashboardUid: 'template',
          dashboardName: 'Test',
          profile: 'profile1',
          grafanaLabel: 'grafana1',
          readOnly: false,
        };

        const testRunProd: any = {
          systemUnderTest: { name: 'my-app' },
          testEnvironment: 'production',
          systemUnderTestId: 'sut-id',
        };

        const testRunDev: any = {
          systemUnderTest: { name: 'my-app' },
          testEnvironment: 'development',
          systemUnderTestId: 'sut-id',
        };

        const uidProd = DashboardUid.from(testRunProd, autoConfigDashboard);
        const uidDev = DashboardUid.from(testRunDev, autoConfigDashboard);

        expect(uidProd.dashboardUid).not.toBe(uidDev.dashboardUid);
      });

      it('should generate same UID for same test run and config', () => {
        const autoConfigDashboard: AutoConfigDashboard = {
          dashboardUid: 'template',
          dashboardName: 'Test',
          profile: 'profile1',
          grafanaLabel: 'grafana1',
          readOnly: false,
        };

        const uid1 = DashboardUid.from(mockTestRun, autoConfigDashboard);
        const uid2 = DashboardUid.from(mockTestRun, autoConfigDashboard);

        expect(uid1.dashboardUid).toBe(uid2.dashboardUid);
      });
    });

    describe('readOnly undefined (defaults to false)', () => {
      it('should treat undefined readOnly as false (writable)', () => {
        const autoConfigDashboard: AutoConfigDashboard = {
          dashboardUid: 'template',
          dashboardName: 'Test',
          profile: 'profile1',
          grafanaLabel: 'grafana1',
          // readOnly not specified - should default to false
        };

        const result = DashboardUid.from(mockTestRun, autoConfigDashboard);

        // Should be hashed, not template UID directly
        expect(result.dashboardUid).not.toBe('template');
        expect(result.dashboardUid).toMatch(/^[a-f0-9]{32}$/);
      });
    });
  });

  describe('legacyFrom (separate dashboard variables)', () => {
    const mockTestRun: any = {
      systemUnderTest: { name: 'my-app' },
      testEnvironment: 'production',
      systemUnderTestId: 'sut-id',
    };

    const autoConfigDashboard: AutoConfigDashboard = {
      dashboardUid: 'template',
      dashboardName: 'Test Dashboard',
      profile: 'profile1',
      grafanaLabel: 'grafana1',
      createSeparateDashboardForVariable: 'workload',
    };

    it('should include variable values in hash', () => {
      const variables: DashboardVariable[] = [{ name: 'workload', values: ['frontend'] }];

      const uid = DashboardUid.legacyFrom(mockTestRun, autoConfigDashboard, variables);

      expect(uid.dashboardUid).toMatch(/^[a-f0-9]{32}$/);
    });

    it('should generate different UIDs for different variable values', () => {
      const variablesA: DashboardVariable[] = [{ name: 'workload', values: ['frontend'] }];

      const variablesB: DashboardVariable[] = [{ name: 'workload', values: ['backend'] }];

      const uidA = DashboardUid.legacyFrom(mockTestRun, autoConfigDashboard, variablesA);
      const uidB = DashboardUid.legacyFrom(mockTestRun, autoConfigDashboard, variablesB);

      expect(uidA.dashboardUid).not.toBe(uidB.dashboardUid);
    });

    it('should filter out hardcoded variables from hash', () => {
      const configWithHardcoded: AutoConfigDashboard = {
        ...autoConfigDashboard,
        setHardcodedValueForVariables: [{ name: 'region', values: ['us-east-1'] }],
      };

      const variables: DashboardVariable[] = [
        { name: 'workload', values: ['frontend'] },
        { name: 'region', values: ['us-east-1'] },
      ];

      const uid = DashboardUid.legacyFrom(mockTestRun, configWithHardcoded, variables);

      // Should still work, just won't include 'region' in hash
      expect(uid.dashboardUid).toMatch(/^[a-f0-9]{32}$/);
    });

    it('should always include system_under_test and test_environment', () => {
      const variables: DashboardVariable[] = [
        { name: 'system_under_test', values: ['my-app'] },
        { name: 'test_environment', values: ['production'] },
        { name: 'workload', values: ['frontend'] },
      ];

      const uid = DashboardUid.legacyFrom(mockTestRun, autoConfigDashboard, variables);

      expect(uid.dashboardUid).toMatch(/^[a-f0-9]{32}$/);
    });
  });

  describe('flattenVariables', () => {
    it('should flatten empty variables to empty string', () => {
      const result = DashboardUid.flattenVariables([]);
      expect(result).toBe('');
    });

    it('should flatten single variable with single value', () => {
      const variables: DashboardVariable[] = [{ name: 'var1', values: ['value1'] }];

      const result = DashboardUid.flattenVariables(variables);
      expect(result).toBe('var1value1');
    });

    it('should flatten single variable with multiple values', () => {
      const variables: DashboardVariable[] = [
        { name: 'workload', values: ['frontend', 'backend'] },
      ];

      const result = DashboardUid.flattenVariables(variables);
      expect(result).toBe('workloadfrontendbackend');
    });

    it('should flatten multiple variables', () => {
      const variables: DashboardVariable[] = [
        { name: 'system_under_test', values: ['my-app'] },
        { name: 'test_environment', values: ['production'] },
        { name: 'workload', values: ['frontend'] },
      ];

      const result = DashboardUid.flattenVariables(variables);
      expect(result).toBe('system_under_testmy-apptest_environmentproductionworkloadfrontend');
    });
  });

  describe('createDashboardUid (convenience function)', () => {
    const mockTestRun: any = {
      systemUnderTest: { name: 'my-app' },
      testEnvironment: 'production',
      systemUnderTestId: 'sut-id',
    };

    it('should use legacyFrom when createSeparateDashboardForVariable is set', () => {
      const autoConfigDashboard: AutoConfigDashboard = {
        dashboardUid: 'template',
        dashboardName: 'Test',
        profile: 'profile1',
        grafanaLabel: 'grafana1',
        createSeparateDashboardForVariable: 'workload',
      };

      const variables: DashboardVariable[] = [{ name: 'workload', values: ['frontend'] }];

      const uid = createDashboardUid(mockTestRun, autoConfigDashboard, variables);

      expect(uid).toMatch(/^[a-f0-9]{32}$/);
    });

    it('should use from when createSeparateDashboardForVariable is not set', () => {
      const autoConfigDashboard: AutoConfigDashboard = {
        dashboardUid: 'template-123',
        dashboardName: 'Test',
        profile: 'profile1',
        grafanaLabel: 'grafana1',
        readOnly: true,
      };

      const variables: DashboardVariable[] = [];

      const uid = createDashboardUid(mockTestRun, autoConfigDashboard, variables);

      // readOnly: true should use template UID directly
      expect(uid).toBe('template-123');
    });
  });

  describe('Real-world September 17 scenario', () => {
    it('should recreate the 20 dashboards with readOnly: true', () => {
      // This tests the CRITICAL scenario from Sept 17, 2025
      // where 20 dashboards were created using readOnly: true mode
      const templateUid = 'perfana-gatling-overview';

      const testRuns: any[] = [
        { systemUnderTest: { name: 'app1' }, testEnvironment: 'prod', systemUnderTestId: 'sut-id' },
        { systemUnderTest: { name: 'app2' }, testEnvironment: 'prod', systemUnderTestId: 'sut-id' },
        { systemUnderTest: { name: 'app3' }, testEnvironment: 'staging', systemUnderTestId: 'sut-id' },
      ];

      const autoConfigDashboard: AutoConfigDashboard = {
        dashboardUid: templateUid,
        dashboardName: 'Gatling Overview',
        profile: 'profile1',
        grafanaLabel: 'grafana1',
        readOnly: true, // CRITICAL: This was set for the 20 dashboards
      };

      // All test runs should get the SAME template UID
      const uids = testRuns.map((tr) => DashboardUid.from(tr, autoConfigDashboard).dashboardUid);

      expect(uids).toEqual([templateUid, templateUid, templateUid]);
      expect(new Set(uids).size).toBe(1); // All UIDs are the same
    });
  });
});
