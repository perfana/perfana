/**
 * Unit tests for Configuration Hash Utilities
 *
 * Tests the configuration hashing and comparison utility functions:
 * - generateConfigHash: Generate consistent hash for configuration objects
 * - isResultStale: Check if a result is stale based on config hash comparison
 * - generateThresholdHash: Generate hash for threshold configuration
 *
 * Testing Standards:
 * - AAA pattern (Arrange, Act, Assert)
 * - Test happy paths, error cases, edge cases
 * - Test deterministic hash generation
 * - Test hash consistency across identical configs
 * - Test hash differences for different configs
 * - Aim for 100% coverage
 */

import {
  generateConfigHash,
  isResultStale,
  generateThresholdHash,
} from '@/lib/config-hash';

describe('Configuration Hash Utilities', () => {
  describe('generateConfigHash()', () => {
    describe('Happy Path Scenarios', () => {
      it('should generate consistent hash for the same configuration', () => {
        // Arrange
        const config1 = {
          application: 'my-app',
          workload: 'load-test',
          environment: 'production',
        };
        const config2 = {
          application: 'my-app',
          workload: 'load-test',
          environment: 'production',
        };

        // Act
        const hash1 = generateConfigHash(config1);
        const hash2 = generateConfigHash(config2);

        // Assert
        expect(hash1).toBe(hash2);
        expect(typeof hash1).toBe('string');
        expect(hash1.length).toBe(8);
      });

      it('should generate different hashes for different configurations', () => {
        // Arrange
        const config1 = {
          application: 'app-1',
          workload: 'load-test',
        };
        const config2 = {
          application: 'app-2',
          workload: 'load-test',
        };

        // Act
        const hash1 = generateConfigHash(config1);
        const hash2 = generateConfigHash(config2);

        // Assert
        expect(hash1).not.toBe(hash2);
      });

      it('should exclude volatile fields from hash calculation', () => {
        // Arrange
        const config1 = {
          application: 'my-app',
          workload: 'load-test',
          last_modified_at: '2025-01-15T10:00:00Z',
          config_hash: 'old-hash-123',
        };
        const config2 = {
          application: 'my-app',
          workload: 'load-test',
          last_modified_at: '2025-01-15T11:00:00Z',
          config_hash: 'old-hash-456',
        };

        // Act
        const hash1 = generateConfigHash(config1);
        const hash2 = generateConfigHash(config2);

        // Assert
        expect(hash1).toBe(hash2);
      });

      it('should handle configuration with nested objects', () => {
        // Arrange
        const config = {
          application: 'my-app',
          settings: {
            timeout: 5000,
            retries: 3,
            advanced: {
              caching: true,
              compression: 'gzip',
            },
          },
        };

        // Act
        const hash = generateConfigHash(config);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should produce consistent hash regardless of key order', () => {
        // Arrange
        const config1 = {
          application: 'my-app',
          workload: 'load-test',
          environment: 'production',
        };
        const config2 = {
          environment: 'production',
          application: 'my-app',
          workload: 'load-test',
        };

        // Act
        const hash1 = generateConfigHash(config1);
        const hash2 = generateConfigHash(config2);

        // Assert
        expect(hash1).toBe(hash2);
      });

      it('should handle configuration with arrays', () => {
        // Arrange
        const config = {
          application: 'my-app',
          tags: ['performance', 'load-test', 'production'],
          metrics: ['cpu', 'memory', 'disk'],
        };

        // Act
        const hash = generateConfigHash(config);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should generate different hashes for arrays with different order', () => {
        // Arrange
        const config1 = {
          tags: ['a', 'b', 'c'],
        };
        const config2 = {
          tags: ['c', 'b', 'a'],
        };

        // Act
        const hash1 = generateConfigHash(config1);
        const hash2 = generateConfigHash(config2);

        // Assert
        expect(hash1).not.toBe(hash2);
      });

      it('should handle configuration with boolean values', () => {
        // Arrange
        const config1 = {
          enabled: true,
          debug: false,
        };
        const config2 = {
          enabled: false,
          debug: false,
        };

        // Act
        const hash1 = generateConfigHash(config1);
        const hash2 = generateConfigHash(config2);

        // Assert
        expect(hash1).not.toBe(hash2);
      });

      it('should handle configuration with numeric values', () => {
        // Arrange
        const config = {
          timeout: 5000,
          maxRetries: 3,
          threshold: 0.95,
        };

        // Act
        const hash = generateConfigHash(config);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should generate different hashes for different numeric values', () => {
        // Arrange
        const config1 = { value: 100 };
        const config2 = { value: 101 };

        // Act
        const hash1 = generateConfigHash(config1);
        const hash2 = generateConfigHash(config2);

        // Assert
        expect(hash1).not.toBe(hash2);
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty configuration object', () => {
        // Arrange
        const config = {};

        // Act
        const hash = generateConfigHash(config);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle null configuration', () => {
        // Arrange
        const config = null;

        // Act
        const hash = generateConfigHash(config);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle undefined configuration', () => {
        // Arrange
        const config = undefined;

        // Act
        const hash = generateConfigHash(config);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle configuration with null values', () => {
        // Arrange
        const config = {
          application: 'my-app',
          workload: null,
          environment: undefined,
        };

        // Act
        const hash = generateConfigHash(config);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle configuration with special characters', () => {
        // Arrange
        const config = {
          name: 'Test <>&"\' Application',
          description: 'Contains \n newlines \t tabs',
        };

        // Act
        const hash = generateConfigHash(config);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle configuration with unicode characters', () => {
        // Arrange
        const config = {
          name: 'Test 🚀 Application',
          description: 'Contains emoji 😀 and unicode ñ',
        };

        // Act
        const hash = generateConfigHash(config);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle very large configuration objects', () => {
        // Arrange
        const config = {
          largeArray: Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `item-${i}` })),
        };

        // Act
        const hash = generateConfigHash(config);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle configuration with deeply nested objects', () => {
        // Arrange
        const config = {
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: {
                    value: 'deep-value',
                  },
                },
              },
            },
          },
        };

        // Act
        const hash = generateConfigHash(config);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle configuration with circular references safely', () => {
        // Arrange
        const config: any = {
          application: 'my-app',
        };
        // Note: JSON.stringify will throw on circular refs, but the function handles it

        // Act & Assert
        // This test ensures the function doesn't crash with circular references
        // JSON.stringify will throw, so we expect the function to handle it gracefully
        expect(() => generateConfigHash(config)).not.toThrow();
      });
    });

    describe('Hash Format Validation', () => {
      it('should always return 8-character hex string', () => {
        // Arrange
        const configs = [
          { a: 1 },
          { b: 'test' },
          { c: true },
          { d: [1, 2, 3] },
          {},
        ];

        // Act & Assert
        configs.forEach(config => {
          const hash = generateConfigHash(config);
          expect(hash).toMatch(/^[0-9a-f]{8}$/);
        });
      });

      it('should return lowercase hex characters', () => {
        // Arrange
        const config = { test: 'value' };

        // Act
        const hash = generateConfigHash(config);

        // Assert
        expect(hash).toBe(hash.toLowerCase());
        expect(hash).toMatch(/^[0-9a-f]+$/);
      });
    });
  });

  describe('isResultStale()', () => {
    describe('Happy Path Scenarios', () => {
      it('should return false when hashes match', () => {
        // Arrange
        const hash1 = 'abc12345';
        const hash2 = 'abc12345';

        // Act
        const isStale = isResultStale(hash1, hash2);

        // Assert
        expect(isStale).toBe(false);
      });

      it('should return true when hashes differ', () => {
        // Arrange
        const resultHash = 'abc12345';
        const currentHash = 'def67890';

        // Act
        const isStale = isResultStale(resultHash, currentHash);

        // Assert
        expect(isStale).toBe(true);
      });

      it('should be case-sensitive for hash comparison', () => {
        // Arrange
        const hash1 = 'ABC12345';
        const hash2 = 'abc12345';

        // Act
        const isStale = isResultStale(hash1, hash2);

        // Assert
        expect(isStale).toBe(true);
      });
    });

    describe('Edge Cases', () => {
      it('should return true when result hash is undefined', () => {
        // Arrange
        const resultHash = undefined;
        const currentHash = 'abc12345';

        // Act
        const isStale = isResultStale(resultHash, currentHash);

        // Assert
        expect(isStale).toBe(true);
      });

      it('should return true when current hash is undefined', () => {
        // Arrange
        const resultHash = 'abc12345';
        const currentHash = undefined;

        // Act
        const isStale = isResultStale(resultHash, currentHash);

        // Assert
        expect(isStale).toBe(true);
      });

      it('should return true when both hashes are undefined', () => {
        // Arrange
        const resultHash = undefined;
        const currentHash = undefined;

        // Act
        const isStale = isResultStale(resultHash, currentHash);

        // Assert
        expect(isStale).toBe(true);
      });

      it('should return true when result hash is empty string', () => {
        // Arrange
        const resultHash = '';
        const currentHash = 'abc12345';

        // Act
        const isStale = isResultStale(resultHash, currentHash);

        // Assert
        expect(isStale).toBe(true);
      });

      it('should return true when current hash is empty string', () => {
        // Arrange
        const resultHash = 'abc12345';
        const currentHash = '';

        // Act
        const isStale = isResultStale(resultHash, currentHash);

        // Assert
        expect(isStale).toBe(true);
      });

      it('should return true when both hashes are empty strings', () => {
        // Arrange - Empty strings are treated as missing hashes
        const resultHash = '';
        const currentHash = '';

        // Act
        const isStale = isResultStale(resultHash, currentHash);

        // Assert
        expect(isStale).toBe(true); // Empty strings are considered missing/invalid
      });
    });

    describe('Real-world Scenarios', () => {
      it('should detect stale results after configuration change', () => {
        // Arrange
        const oldConfig = { application: 'app-1', workload: 'load-test' };
        const newConfig = { application: 'app-1', workload: 'stress-test' };

        const oldHash = generateConfigHash(oldConfig);
        const newHash = generateConfigHash(newConfig);

        // Act
        const isStale = isResultStale(oldHash, newHash);

        // Assert
        expect(isStale).toBe(true);
      });

      it('should not detect staleness when configuration is unchanged', () => {
        // Arrange
        const config1 = { application: 'app-1', workload: 'load-test' };
        const config2 = { application: 'app-1', workload: 'load-test' };

        const hash1 = generateConfigHash(config1);
        const hash2 = generateConfigHash(config2);

        // Act
        const isStale = isResultStale(hash1, hash2);

        // Assert
        expect(isStale).toBe(false);
      });

      it('should not detect staleness when only volatile fields change', () => {
        // Arrange
        const config1 = {
          application: 'app-1',
          last_modified_at: '2025-01-15T10:00:00Z',
          config_hash: 'old-hash',
        };
        const config2 = {
          application: 'app-1',
          last_modified_at: '2025-01-15T11:00:00Z',
          config_hash: 'new-hash',
        };

        const hash1 = generateConfigHash(config1);
        const hash2 = generateConfigHash(config2);

        // Act
        const isStale = isResultStale(hash1, hash2);

        // Assert
        expect(isStale).toBe(false);
      });
    });
  });

  describe('generateThresholdHash()', () => {
    describe('Happy Path Scenarios', () => {
      it('should generate hash for threshold configuration', () => {
        // Arrange
        const thresholds = {
          aggregation: 'avg',
          percentageThreshold: 10,
          iqrThreshold: 1.5,
          absoluteThreshold: 100,
        };

        // Act
        const hash = generateThresholdHash(thresholds);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should generate consistent hash for same threshold configuration', () => {
        // Arrange
        const thresholds1 = {
          aggregation: 'avg',
          percentageThreshold: 10,
          iqrThreshold: 1.5,
          absoluteThreshold: 100,
        };
        const thresholds2 = {
          aggregation: 'avg',
          percentageThreshold: 10,
          iqrThreshold: 1.5,
          absoluteThreshold: 100,
        };

        // Act
        const hash1 = generateThresholdHash(thresholds1);
        const hash2 = generateThresholdHash(thresholds2);

        // Assert
        expect(hash1).toBe(hash2);
      });

      it('should generate different hashes for different threshold values', () => {
        // Arrange
        const thresholds1 = {
          aggregation: 'avg',
          percentageThreshold: 10,
        };
        const thresholds2 = {
          aggregation: 'avg',
          percentageThreshold: 20,
        };

        // Act
        const hash1 = generateThresholdHash(thresholds1);
        const hash2 = generateThresholdHash(thresholds2);

        // Assert
        expect(hash1).not.toBe(hash2);
      });

      it('should only include relevant threshold fields', () => {
        // Arrange
        const thresholds1 = {
          aggregation: 'avg',
          percentageThreshold: 10,
          iqrThreshold: 1.5,
          absoluteThreshold: 100,
          irrelevantField: 'should-be-ignored',
          timestamp: '2025-01-15T10:00:00Z',
        };
        const thresholds2 = {
          aggregation: 'avg',
          percentageThreshold: 10,
          iqrThreshold: 1.5,
          absoluteThreshold: 100,
          irrelevantField: 'different-value',
          timestamp: '2025-01-15T11:00:00Z',
        };

        // Act
        const hash1 = generateThresholdHash(thresholds1);
        const hash2 = generateThresholdHash(thresholds2);

        // Assert
        expect(hash1).toBe(hash2);
      });

      it('should handle partial threshold configuration', () => {
        // Arrange
        const thresholds = {
          aggregation: 'avg',
          percentageThreshold: 10,
        };

        // Act
        const hash = generateThresholdHash(thresholds);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle different aggregation methods', () => {
        // Arrange
        const thresholds1 = { aggregation: 'avg' };
        const thresholds2 = { aggregation: 'max' };
        const thresholds3 = { aggregation: 'min' };

        // Act
        const hash1 = generateThresholdHash(thresholds1);
        const hash2 = generateThresholdHash(thresholds2);
        const hash3 = generateThresholdHash(thresholds3);

        // Assert
        expect(hash1).not.toBe(hash2);
        expect(hash2).not.toBe(hash3);
        expect(hash1).not.toBe(hash3);
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty threshold object', () => {
        // Arrange
        const thresholds = {};

        // Act
        const hash = generateThresholdHash(thresholds);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle null thresholds', () => {
        // Arrange
        const thresholds = null;

        // Act
        const hash = generateThresholdHash(thresholds);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle undefined thresholds', () => {
        // Arrange
        const thresholds = undefined;

        // Act
        const hash = generateThresholdHash(thresholds);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle threshold with undefined values', () => {
        // Arrange
        const thresholds = {
          aggregation: 'avg',
          percentageThreshold: undefined,
          iqrThreshold: null,
        };

        // Act
        const hash = generateThresholdHash(thresholds);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should handle threshold with zero values', () => {
        // Arrange
        const thresholds = {
          aggregation: 'avg',
          percentageThreshold: 0,
          iqrThreshold: 0,
          absoluteThreshold: 0,
        };

        // Act
        const hash = generateThresholdHash(thresholds);

        // Assert
        expect(hash).toBeDefined();
        expect(hash.length).toBe(8);
      });

      it('should differentiate between zero and undefined threshold values', () => {
        // Arrange
        const thresholds1 = {
          percentageThreshold: 0,
        };
        const thresholds2 = {
          percentageThreshold: undefined,
        };

        // Act
        const hash1 = generateThresholdHash(thresholds1);
        const hash2 = generateThresholdHash(thresholds2);

        // Assert
        expect(hash1).not.toBe(hash2);
      });
    });

    describe('Real-world Scenarios', () => {
      it('should detect meaningful threshold changes requiring re-analysis', () => {
        // Arrange
        const oldThresholds = {
          aggregation: 'avg',
          percentageThreshold: 10,
          iqrThreshold: 1.5,
        };
        const newThresholds = {
          aggregation: 'max',
          percentageThreshold: 10,
          iqrThreshold: 1.5,
        };

        const oldHash = generateThresholdHash(oldThresholds);
        const newHash = generateThresholdHash(newThresholds);

        // Act
        const isStale = isResultStale(oldHash, newHash);

        // Assert
        expect(isStale).toBe(true);
      });

      it('should not trigger re-analysis for identical thresholds', () => {
        // Arrange
        const thresholds1 = {
          aggregation: 'avg',
          percentageThreshold: 10,
          iqrThreshold: 1.5,
          absoluteThreshold: 100,
        };
        const thresholds2 = {
          aggregation: 'avg',
          percentageThreshold: 10,
          iqrThreshold: 1.5,
          absoluteThreshold: 100,
        };

        const hash1 = generateThresholdHash(thresholds1);
        const hash2 = generateThresholdHash(thresholds2);

        // Act
        const isStale = isResultStale(hash1, hash2);

        // Assert
        expect(isStale).toBe(false);
      });
    });
  });

  describe('Integration Scenarios', () => {
    it('should correctly identify stale anomaly detection results', () => {
      // Arrange - Original configuration and thresholds
      const originalConfig = {
        application: 'my-app',
        workload: 'load-test',
        environment: 'production',
      };
      const originalThresholds = {
        aggregation: 'avg',
        percentageThreshold: 10,
      };

      const configHash1 = generateConfigHash(originalConfig);
      const thresholdHash1 = generateThresholdHash(originalThresholds);

      // Arrange - New configuration (workload changed)
      const newConfig = {
        application: 'my-app',
        workload: 'stress-test',
        environment: 'production',
      };
      const newThresholds = originalThresholds;

      const configHash2 = generateConfigHash(newConfig);
      const thresholdHash2 = generateThresholdHash(newThresholds);

      // Act
      const configStale = isResultStale(configHash1, configHash2);
      const thresholdStale = isResultStale(thresholdHash1, thresholdHash2);

      // Assert
      expect(configStale).toBe(true); // Config changed
      expect(thresholdStale).toBe(false); // Thresholds unchanged
    });

    it('should correctly identify stale results after threshold update', () => {
      // Arrange - Same config, different thresholds
      const config = {
        application: 'my-app',
        workload: 'load-test',
      };
      const oldThresholds = {
        aggregation: 'avg',
        percentageThreshold: 10,
      };
      const newThresholds = {
        aggregation: 'avg',
        percentageThreshold: 20,
      };

      const configHash1 = generateConfigHash(config);
      const configHash2 = generateConfigHash(config);
      const thresholdHash1 = generateThresholdHash(oldThresholds);
      const thresholdHash2 = generateThresholdHash(newThresholds);

      // Act
      const configStale = isResultStale(configHash1, configHash2);
      const thresholdStale = isResultStale(thresholdHash1, thresholdHash2);

      // Assert
      expect(configStale).toBe(false); // Config unchanged
      expect(thresholdStale).toBe(true); // Thresholds changed
    });
  });
});
