import { createHash } from 'crypto';
import { TestRun } from '@perfana/shared/entities';
import { DashboardVariable } from './types';

/**
 * Dashboard UID Generation Utility
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
  grafanaLabel: string;
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
   * Generate dashboard UID for regular or readOnly dashboards.
   * This is the CRITICAL method that determines UID generation behavior.
   */
  static from(
    testRun: TestRun,
    autoConfigDashboard: AutoConfigDashboard,
  ): DashboardUid {
    const dashboardUid = autoConfigDashboard.dashboardUid;

    if (autoConfigDashboard.readOnly) {
      // readOnly: true → Use template UID directly
      // This is how the 20 dashboards were created on Sept 17!
      return DashboardUid.fromString(dashboardUid);
    } else {
      // readOnly: false → Generate MD5 hash for new dashboard
      // CRITICAL: Uses systemUnderTest.name, not systemUnderTestId (from old working code)
      const systemUnderTestName = testRun.systemUnderTest?.name || testRun.systemUnderTestId;
      const toBeHashed = `${systemUnderTestName}${testRun.testEnvironment}${autoConfigDashboard.grafanaLabel}${dashboardUid}`;
      const hashed = DashboardUid.fromHashedString(toBeHashed);
      return hashed;
    }
  }

  /**
   * Generate legacy dashboard UID for backwards compatibility.
   * Used when createSeparateDashboardForVariable is set.
   */
  static legacyFrom(
    testRun: TestRun,
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

    // CRITICAL: Uses systemUnderTest.name, not systemUnderTestId (from old working code)
    const systemUnderTestName = testRun.systemUnderTest?.name || testRun.systemUnderTestId;
    const toBeHashed = `${systemUnderTestName}${testRun.testEnvironment}${autoConfigDashboard.grafanaLabel}${autoConfigDashboard.dashboardUid}${flattenedVariables}`;

    const hashedDashboardUid = DashboardUid.fromHashedString(toBeHashed);

    return hashedDashboardUid;
  }

  /**
   * Flatten variables into a string for hashing
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

export function createDashboardUid(
  testRun: TestRun,
  autoConfigDashboard: AutoConfigDashboard,
  variables: DashboardVariable[],
): string {
  if (autoConfigDashboard.createSeparateDashboardForVariable) {
    return DashboardUid.legacyFrom(testRun, autoConfigDashboard, variables).dashboardUid;
  } else {
    return DashboardUid.from(testRun, autoConfigDashboard).dashboardUid;
  }
}
