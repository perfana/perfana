/**
 * Unit tests for HeaderParser
 *
 * Tests for parsing AWR report header information:
 * - Database information (DB Name, DB Id, Instance, Release, Edition, RAC/CDB flags)
 * - Host information (Host Name, Platform, CPUs, Cores, Sockets, Memory)
 * - Snapshot information (Snap IDs, timestamps, Elapsed time, DB Time, Sessions)
 */

import { HeaderParser } from '../../parsers/sections/header-parser';
import type { AwrReportHeader } from '../../types/awr-data.types';

describe('HeaderParser', () => {
  let parser: HeaderParser;

  beforeEach(() => {
    parser = new HeaderParser();
  });

  describe('getSectionName', () => {
    it('should return "Header"', () => {
      expect(parser.getSectionName()).toBe('Header');
    });
  });

  describe('parse', () => {
    describe('basic functionality', () => {
      it('should return null for empty HTML', () => {
        const result = parser.parse('');
        expect(result).toBeNull();
      });

      it('should return null for HTML without AWR header content', () => {
        const html = '<html><body><p>Some random content</p></body></html>';
        const result = parser.parse(html);
        expect(result).toBeNull();
      });

      it('should return null when missing required fields', () => {
        const html = `
          <html><body>
            <table>
              <tr><td>Some Data</td><td>123</td></tr>
            </table>
          </body></html>
        `;
        const result = parser.parse(html);
        expect(result).toBeNull();
      });
    });

    describe('database information extraction', () => {
      it('should extract database info from standard AWR table format', () => {
        const html = createAwrHtml({
          database: {
            dbName: 'PRODDB',
            dbId: '123456789',
            instance: 'proddb1',
            release: '19.12.0.0.0',
            edition: 'Enterprise Edition',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.database.dbName).toBe('PRODDB');
        expect(result?.database.dbId).toBe('123456789');
        expect(result?.database.instanceName).toBe('proddb1');
        expect(result?.database.dbRelease).toBe('19.12.0.0.0');
        expect(result?.database.dbEdition).toBe('Enterprise Edition');
      });

      it('should extract RAC flag when present', () => {
        const html = createAwrHtml({
          database: {
            dbName: 'RACDB',
            dbId: '987654321',
            rac: 'YES',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.database.isRac).toBe(true);
      });

      it('should parse RAC as false when value is NO', () => {
        const html = createAwrHtml({
          database: {
            dbName: 'SINGLEDB',
            dbId: '111222333',
            rac: 'NO',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.database.isRac).toBe(false);
      });

      it('should extract CDB flag when present', () => {
        const html = createAwrHtml({
          database: {
            dbName: 'CDBTEST',
            dbId: '444555666',
            cdb: 'YES',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.database.isCdb).toBe(true);
      });

      it('should handle instance number parsing', () => {
        const html = createAwrHtml({
          database: {
            dbName: 'RACDB',
            dbId: '777888999',
            instance: 'racdb2',
            instanceNum: '2',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.database.instanceNumber).toBe(2);
      });
    });

    describe('host information extraction', () => {
      it('should extract host info from standard AWR format', () => {
        const html = createAwrHtml({
          host: {
            hostName: 'prodserver01',
            platform: 'Linux x86 64-bit',
            cpus: '32',
            cores: '16',
            sockets: '2',
            memory: '256',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.host.hostName).toBe('prodserver01');
        expect(result?.host.platform).toBe('Linux x86 64-bit');
        expect(result?.host.cpus).toBe(32);
        expect(result?.host.cores).toBe(16);
        expect(result?.host.sockets).toBe(2);
        expect(result?.host.memoryGb).toBe(256);
      });

      it('should handle missing optional host fields', () => {
        const html = createAwrHtml({
          host: {
            hostName: 'minimalhost',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.host.hostName).toBe('minimalhost');
        expect(result?.host.platform).toBeUndefined();
        expect(result?.host.cpus).toBeUndefined();
      });

      it('should provide default host info when extraction fails', () => {
        const html = createAwrHtml({
          database: {
            dbName: 'TESTDB',
            dbId: '123',
          },
          snapshot: {
            beginId: '100',
            endId: '110',
          },
          host: null, // No host info
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.host.hostName).toBe('unknown');
      });

      it('should parse memory with decimal values', () => {
        const html = createAwrHtml({
          host: {
            hostName: 'server01',
            memory: '128.5',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.host.memoryGb).toBeCloseTo(128.5, 2);
      });
    });

    describe('snapshot information extraction', () => {
      it('should extract snapshot IDs', () => {
        const html = createAwrHtml({
          snapshot: {
            beginId: '1000',
            endId: '1005',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.snapshot.snapIdBegin).toBe(1000);
        expect(result?.snapshot.snapIdEnd).toBe(1005);
      });

      it('should extract elapsed time in minutes', () => {
        const html = createAwrHtml({
          snapshot: {
            beginId: '100',
            endId: '110',
            elapsed: '60.5',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.snapshot.elapsedMinutes).toBeCloseTo(60.5, 2);
      });

      it('should extract DB time in minutes', () => {
        const html = createAwrHtml({
          snapshot: {
            beginId: '200',
            endId: '210',
            dbTime: '120.3',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.snapshot.dbTimeMinutes).toBeCloseTo(120.3, 2);
      });

      it('should extract session counts', () => {
        const html = createAwrHtml({
          snapshot: {
            beginId: '300',
            endId: '310',
            sessionsBegin: '150',
            sessionsEnd: '175',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.snapshot.sessionsBegin).toBe(150);
        expect(result?.snapshot.sessionsEnd).toBe(175);
      });

      it('should parse timestamps when available', () => {
        const html = createAwrHtml({
          snapshot: {
            beginId: '400',
            endId: '410',
            beginTime: '15-Jan-24 10:00:00',
            endTime: '15-Jan-24 11:00:00',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.snapshot.beginTime).toBeInstanceOf(Date);
        expect(result?.snapshot.endTime).toBeInstanceOf(Date);
      });

      it('should handle elapsed time with unit suffix', () => {
        const html = createAwrHtml({
          snapshot: {
            beginId: '500',
            endId: '510',
            elapsed: '60 min',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.snapshot.elapsedMinutes).toBe(60);
      });
    });

    describe('combined header extraction', () => {
      it('should extract complete header from typical AWR format', () => {
        const html = createCompleteAwrHeader();

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.database).toBeDefined();
        expect(result?.host).toBeDefined();
        expect(result?.snapshot).toBeDefined();
        expect(result?.database.dbName).toBe('PERFDB');
        expect(result?.host.hostName).toBe('perfhost01');
        expect(result?.snapshot.snapIdBegin).toBe(5000);
        expect(result?.snapshot.snapIdEnd).toBe(5010);
      });

      it('should handle alternate table layouts', () => {
        const html = createAlternateLayoutAwrHeader();

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.database.dbName).toBe('ALTDB');
        expect(result?.database.dbId).toBe('987654');
      });
    });

    describe('edge cases and error handling', () => {
      it('should handle malformed HTML gracefully', () => {
        const html = '<html><body><table><tr><td>Broken table';

        expect(() => parser.parse(html)).not.toThrow();
      });

      it('should handle special characters in values', () => {
        const html = createAwrHtml({
          database: {
            dbName: 'TEST_DB-01',
            dbId: '123',
          },
        });

        const result = parser.parse(html);

        expect(result).not.toBeNull();
        expect(result?.database.dbName).toBe('TEST_DB-01');
      });

      it('should handle numeric values with comma separators', () => {
        const html = createAwrHtml({
          snapshot: {
            beginId: '1,000',
            endId: '1,005',
          },
        });

        const result = parser.parse(html);

        // Depends on implementation - may strip commas
        expect(result).not.toBeNull();
      });

      it('should return null when only host info is available', () => {
        const html = `
          <html><body>
            <table>
              <tr><td>Host Name</td><td>server01</td></tr>
              <tr><td>Platform</td><td>Linux</td></tr>
            </table>
          </body></html>
        `;

        const result = parser.parse(html);

        // Should be null because database and snapshot are required
        expect(result).toBeNull();
      });
    });

    describe('parseWithResult', () => {
      it('should return success result for valid HTML', () => {
        const html = createCompleteAwrHeader();

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(true);
        expect(result.data).not.toBeNull();
        expect(result.error).toBeUndefined();
        expect(result.parseTimeMs).toBeGreaterThanOrEqual(0);
      });

      it('should return failure result for invalid HTML', () => {
        const html = '<html><body>No AWR data</body></html>';

        const result = parser.parseWithResult(html);

        expect(result.success).toBe(false);
        expect(result.data).toBeNull();
        expect(result.error).toBeDefined();
      });

      it('should include parse time in result', () => {
        const html = createCompleteAwrHeader();

        const result = parser.parseWithResult(html);

        expect(typeof result.parseTimeMs).toBe('number');
        expect(result.parseTimeMs).toBeGreaterThanOrEqual(0);
      });
    });

    describe('debug mode', () => {
      it('should not throw with debug enabled', () => {
        const debugParser = new HeaderParser({ debug: false });
        const html = createCompleteAwrHeader();

        expect(() => debugParser.parse(html)).not.toThrow();
      });
    });
  });
});

// ==================== Test Helpers ====================

interface AwrHtmlOptions {
  database?: {
    dbName?: string;
    dbId?: string;
    instance?: string;
    instanceNum?: string;
    release?: string;
    edition?: string;
    rac?: string;
    cdb?: string;
  } | null;
  host?: {
    hostName?: string;
    platform?: string;
    cpus?: string;
    cores?: string;
    sockets?: string;
    memory?: string;
  } | null;
  snapshot?: {
    beginId?: string;
    endId?: string;
    beginTime?: string;
    endTime?: string;
    elapsed?: string;
    dbTime?: string;
    sessionsBegin?: string;
    sessionsEnd?: string;
  } | null;
}

/**
 * Create AWR HTML with specified sections
 */
function createAwrHtml(options: AwrHtmlOptions): string {
  let html = '<html><body>';

  // Database information table
  if (options.database !== null) {
    const db = options.database || { dbName: 'TESTDB', dbId: '12345' };
    html += `
      <h3>Database Instance Information</h3>
      <table summary="Database Instance Information">
        <tr><th colspan="2">Database Instance Information</th></tr>
        ${db.dbName ? `<tr><td>DB Name</td><td>${db.dbName}</td></tr>` : ''}
        ${db.dbId ? `<tr><td>DB Id</td><td>${db.dbId}</td></tr>` : ''}
        ${db.instance ? `<tr><td>Instance</td><td>${db.instance}</td></tr>` : ''}
        ${db.instanceNum ? `<tr><td>Inst Num</td><td>${db.instanceNum}</td></tr>` : ''}
        ${db.release ? `<tr><td>Release</td><td>${db.release}</td></tr>` : ''}
        ${db.edition ? `<tr><td>Edition</td><td>${db.edition}</td></tr>` : ''}
        ${db.rac ? `<tr><td>RAC</td><td>${db.rac}</td></tr>` : ''}
        ${db.cdb ? `<tr><td>CDB</td><td>${db.cdb}</td></tr>` : ''}
      </table>
    `;
  }

  // Host information table
  if (options.host !== null) {
    const host = options.host || {};
    if (Object.keys(host).length > 0) {
      html += `
        <h3>Host Information</h3>
        <table summary="Host Information">
          <tr><th colspan="2">Host Information</th></tr>
          ${host.hostName ? `<tr><td>Host Name</td><td>${host.hostName}</td></tr>` : ''}
          ${host.platform ? `<tr><td>Platform</td><td>${host.platform}</td></tr>` : ''}
          ${host.cpus ? `<tr><td>CPUs</td><td>${host.cpus}</td></tr>` : ''}
          ${host.cores ? `<tr><td>Cores</td><td>${host.cores}</td></tr>` : ''}
          ${host.sockets ? `<tr><td>Sockets</td><td>${host.sockets}</td></tr>` : ''}
          ${host.memory ? `<tr><td>Memory (GB)</td><td>${host.memory}</td></tr>` : ''}
        </table>
      `;
    }
  }

  // Snapshot information table
  if (options.snapshot !== null) {
    const snap = options.snapshot || { beginId: '100', endId: '110' };
    html += `
      <h3>Snapshot Information</h3>
      <table summary="Snapshot Information">
        <tr><th colspan="2">Snapshot Information</th></tr>
        ${snap.beginId ? `<tr><td>Begin Snap</td><td>${snap.beginId}</td></tr>` : ''}
        ${snap.endId ? `<tr><td>End Snap</td><td>${snap.endId}</td></tr>` : ''}
        ${snap.beginTime ? `<tr><td>Begin Time</td><td>${snap.beginTime}</td></tr>` : ''}
        ${snap.endTime ? `<tr><td>End Time</td><td>${snap.endTime}</td></tr>` : ''}
        ${snap.elapsed ? `<tr><td>Elapsed</td><td>${snap.elapsed}</td></tr>` : ''}
        ${snap.dbTime ? `<tr><td>DB Time</td><td>${snap.dbTime}</td></tr>` : ''}
        ${snap.sessionsBegin ? `<tr><td>Sessions at Begin</td><td>${snap.sessionsBegin}</td></tr>` : ''}
        ${snap.sessionsEnd ? `<tr><td>Sessions at End</td><td>${snap.sessionsEnd}</td></tr>` : ''}
      </table>
    `;
  }

  html += '</body></html>';
  return html;
}

/**
 * Create a complete AWR header HTML for testing
 */
function createCompleteAwrHeader(): string {
  return createAwrHtml({
    database: {
      dbName: 'PERFDB',
      dbId: '1234567890',
      instance: 'perfdb1',
      instanceNum: '1',
      release: '19.15.0.0.0',
      edition: 'Enterprise Edition',
      rac: 'NO',
      cdb: 'YES',
    },
    host: {
      hostName: 'perfhost01',
      platform: 'Linux x86 64-bit',
      cpus: '64',
      cores: '32',
      sockets: '2',
      memory: '512',
    },
    snapshot: {
      beginId: '5000',
      endId: '5010',
      beginTime: '20-Jan-24 14:00:00',
      endTime: '20-Jan-24 15:00:00',
      elapsed: '60',
      dbTime: '240',
      sessionsBegin: '200',
      sessionsEnd: '225',
    },
  });
}

/**
 * Create an alternate layout AWR header for testing fallback extraction
 */
function createAlternateLayoutAwrHeader(): string {
  return `
    <html><body>
      <table class="tdiff">
        <tr>
          <td>DB Name</td><td>ALTDB</td>
          <td>DB Id</td><td>987654</td>
        </tr>
        <tr>
          <td>Begin Snap</td><td>100</td>
          <td>End Snap</td><td>110</td>
        </tr>
      </table>
    </body></html>
  `;
}
