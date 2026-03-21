import { createHash } from 'crypto';
import { TestRun } from '@perfana/shared/entities';
import { DashboardVariable } from './types';

/**
 * Dashboard UID Generation Utility
 *
 * Migrated from: perfana-grafana/auto-config/dashboard-uid.js
 *
 * Supports two modes:
 * 1. readOnly: true  → Uses template UID directly (no Grafana dashboard creation)
 * 2. readOnly: false → Generates MD5 hash (creates new dashboard in Grafana)
 *
 * CRITICAL: The old system (Sept 17, 2025) created 20 dashboards using readOnly: true mode,
 * which means they use template UIDs directly and allow duplicate UIDs with different variables.
 */

export interface AutoConfigDashboard {
  dashboardUid: string;
  dashboardName: string;
  profile: string;
  grafana: string;
  readOnly?: boolean;
  createSeparateDashboardForVariable?: string;
  setHardcodedValueForVariables?: DashboardVariable[];
}

export class DashboardUid {
  dashboardUidInput: string;
  dashboardUid: string;

  constructor(dashboardUidInput: string, dashboardUid: string) {
    this.dashboardUidInput = dashboardUidInput;
    this.dashboardUid = dashboardUid;
  }

  /**
   * Create dashboard UID from string (no hashing)
   * Used for readOnly: true dashboards
   */
  static fromString(dashboardUid: string): DashboardUid {
    return new DashboardUid(dashboardUid, dashboardUid);
  }

  /**
   * Create dashboard UID from MD5 hashed string
   * Used for readOnly: false dashboards
   */
  static fromHashedString(input: string): DashboardUid {
    const hashed = createHash('md5').update(input).digest('hex');
    return new DashboardUid(input, hashed);
  }

  /**
   * Generate dashboard UID for regular or readOnly dashboards
   *
   * This is the CRITICAL method that determines UID generation behavior!
   *
   * Migrated from: DashboardUid.kt:19-33 and dashboard-uid.js:45-57
   */
  static from(
    testRun: TestRun | MappedTestRun,
    autoConfigDashboard: AutoConfigDashboard,
  ): DashboardUid {
    const dashboardUid = autoConfigDashboard.dashboardUid;

    if (autoConfigDashboard.readOnly) {
      // readOnly: true → Use template UID directly
      // This is how the 20 dashboards were created on Sept 17!
      // console.log(`ReadOnly auto config dashboardUid: ${dashboardUid} for ${autoConfigDashboard.dashboardName}`);
      return DashboardUid.fromString(dashboardUid);
    } else {
      // readOnly: false → Generate MD5 hash for new dashboard
      // CRITICAL: Uses systemUnderTestName, not systemUnderTestId (from old working code)
      const systemUnderTestName =
        'systemUnderTestName' in testRun ? testRun.systemUnderTestName : testRun.systemUnderTestId;
      const toBeHashed = `${systemUnderTestName}${testRun.testEnvironment}${autoConfigDashboard.grafana}${dashboardUid}`;
      const hashed = DashboardUid.fromHashedString(toBeHashed);
      // console.log(`To be hashed: ${toBeHashed} > ${hashed.dashboardUid}`);
      return hashed;
    }
  }

  /**
   * Generate legacy dashboard UID for backwards compatibility
   * Used when createSeparateDashboardForVariable is set
   *
   * Migrated from: DashboardUid.kt:41-63 and dashboard-uid.js:63-83
   */
  static legacyFrom(
    testRun: TestRun | MappedTestRun,
    autoConfigDashboard: AutoConfigDashboard,
    variables: DashboardVariable[],
  ): DashboardUid {
    const hardCodedVarNames =
      autoConfigDashboard.setHardcodedValueForVariables?.map((v) => v.name) || [];

    const filteredHardCodedVars = variables.filter((v) => !hardCodedVarNames.includes(v.name));

    const filteredCreateSeparateDashboardVars = filteredHardCodedVars.filter(
      (v) =>
        v.name === autoConfigDashboard.createSeparateDashboardForVariable ||
        v.name === 'system_under_test' ||
        v.name === 'test_environment',
    );

    const flattenedVariables = DashboardUid.flattenVariables(filteredCreateSeparateDashboardVars);

    // CRITICAL: Uses systemUnderTestName, not systemUnderTestId (from old working code)
    const systemUnderTestName =
      'systemUnderTestName' in testRun ? testRun.systemUnderTestName : testRun.systemUnderTestId;
    const toBeHashed = `${systemUnderTestName}${testRun.testEnvironment}${autoConfigDashboard.grafana}${autoConfigDashboard.dashboardUid}${flattenedVariables}`;

    const hashedDashboardUid = DashboardUid.fromHashedString(toBeHashed);

    // console.log(`To be hashed (legacy): ${toBeHashed} > ${hashedDashboardUid.dashboardUid}`);

    return hashedDashboardUid;
  }

  /**
   * Flatten variables into a string for hashing
   *
   * Migrated from: DashboardUid.kt:65-77 and dashboard-uid.js:89-103
   */
  static flattenVariables(variables: DashboardVariable[]): string {
    if (!variables || variables.length === 0) {
      return '';
    }

    const dashboardVariables: string[] = [];
    variables.forEach((variable) => {
      dashboardVariables.push(variable.name);
      variable.values.forEach((value) => {
        dashboardVariables.push(value);
      });
    });

    return dashboardVariables.join('');
  }

  toString(): string {
    return `dashboardUid: '${this.dashboardUid}'`;
  }

  toFullString(): string {
    return `Hashed dashboard uid: '${this.dashboardUidInput}' -> '${this.dashboardUid}'`;
  }
}

/**
 * Utility function for creating dashboard UID with variables
 * Used in old code for separate dashboard creation
 */
/**
 * Mapped test run structure - compatible with both TestRun entity and MongoDB-style mapped data
 */
export interface MappedTestRun {
  testRunId?: string;
  systemUnderTestName: string;
  systemUnderTestId?: string;
  testEnvironment: string;
  testType?: string;
}

export function createDashboardUid(
  testRun: TestRun | MappedTestRun,
  autoConfigDashboard: AutoConfigDashboard,
  variables: DashboardVariable[],
): string {
  if (autoConfigDashboard.createSeparateDashboardForVariable) {
    return DashboardUid.legacyFrom(testRun, autoConfigDashboard, variables).dashboardUid;
  } else {
    return DashboardUid.from(testRun, autoConfigDashboard).dashboardUid;
  }
}
