import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as puppeteer from 'puppeteer';

/**
 * Browser Pool Service
 *
 * Manages a pool of pre-launched Puppeteer browsers for efficient PDF generation.
 * This avoids the overhead of launching a new browser for each PDF job.
 *
 * Features:
 * - Pre-launched browser pool with configurable size
 * - Round-robin browser allocation
 * - Graceful cleanup on shutdown
 * - Browser recovery on crashes
 */
@Injectable()
export class BrowserPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BrowserPoolService.name);
  private browsers: puppeteer.Browser[] = [];
  private currentBrowserIndex = 0;
  private poolSize: number;
  private isInitialized = false;

  constructor(private readonly configService: ConfigService) {
    this.poolSize = parseInt(this.configService.get('BROWSER_POOL_SIZE', '3'), 10);
  }

  async onModuleInit() {
    this.logger.log(`Initializing browser pool with ${this.poolSize} browsers...`);
    await this.initializePool();
  }

  /**
   * Initialize the browser pool by launching browsers
   */
  private async initializePool(): Promise<void> {
    try {
      const launchPromises = [];

      for (let i = 0; i < this.poolSize; i++) {
        launchPromises.push(this.launchBrowser(i));
      }

      this.browsers = await Promise.all(launchPromises);
      this.isInitialized = true;

      this.logger.log(`Browser pool initialized successfully with ${this.browsers.length} browsers`);
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';

      this.logger.error(`Failed to initialize browser pool: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Launch a single browser instance
   */
  private async launchBrowser(index: number): Promise<puppeteer.Browser> {
    this.logger.debug(`Launching browser ${index + 1}/${this.poolSize}...`);

    try {
      // Get optional Chromium executable path from environment
      // Checks both CHROMIUM_EXECUTABLE_PATH and PUPPETEER_EXECUTABLE_PATH (Dockerfile default)
      // If not set, Puppeteer will use its bundled Chromium (for local dev)
      // In Kubernetes/Alpine, set to: /usr/bin/chromium-browser
      const executablePath =
        this.configService.get<string>('CHROMIUM_EXECUTABLE_PATH') ||
        this.configService.get<string>('PUPPETEER_EXECUTABLE_PATH');

      // Get Puppeteer args from environment or use defaults
      // PUPPETEER_ARGS should be space-separated, e.g.: "--no-sandbox --disable-gpu"
      const puppeteerArgsEnv = this.configService.get<string>('PUPPETEER_ARGS');
      const defaultArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Critical for Kubernetes
        '--disable-gpu',
        '--disable-extensions',
        '--disable-software-rasterizer',
      ];
      const args = puppeteerArgsEnv
        ? puppeteerArgsEnv.split(' ').filter(arg => arg.trim())
        : defaultArgs;

      const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
        headless: true,
        timeout: 90000, // 90 second timeout for browser launch
        args,
      };

      // Only set executablePath if provided (allows Puppeteer's bundled Chrome on local dev)
      if (executablePath) {
        launchOptions.executablePath = executablePath;
        this.logger.log(`Using Chromium executable: ${executablePath}`);
      } else {
        this.logger.log('Using Puppeteer bundled Chromium');
      }

      this.logger.log(`Launching browser ${index + 1} with args: ${args.join(' ')}`);
      const browser = await puppeteer.launch(launchOptions);

      this.logger.debug(`Browser ${index + 1} launched successfully`);
      return browser;
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';

      this.logger.error(`Failed to launch browser ${index + 1}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get a browser from the pool using round-robin allocation
   */
  async getBrowser(): Promise<puppeteer.Browser> {
    if (!this.isInitialized || this.browsers.length === 0) {
      throw new Error('Browser pool is not initialized');
    }

    // Get browser using round-robin
    const browser = this.browsers[this.currentBrowserIndex];

    // Move to next browser for next request
    this.currentBrowserIndex = (this.currentBrowserIndex + 1) % this.browsers.length;

    // Check if browser is still connected, if not, relaunch it
    if (!browser.connected) {
      this.logger.warn(`Browser ${this.currentBrowserIndex} disconnected, relaunching...`);
      const newBrowser = await this.launchBrowser(this.currentBrowserIndex);
      this.browsers[this.currentBrowserIndex] = newBrowser;
      return newBrowser;
    }

    return browser;
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): {
    poolSize: number;
    connected: number;
    disconnected: number;
  } {
    const connected = this.browsers.filter((b) => b.connected).length;
    const disconnected = this.browsers.filter((b) => !b.connected).length;

    return {
      poolSize: this.poolSize,
      connected,
      disconnected,
    };
  }

  /**
   * Check if pool is ready
   */
  isReady(): boolean {
    return this.isInitialized && this.browsers.length > 0;
  }

  async onModuleDestroy() {
    this.logger.log('Closing browser pool...');

    try {
      const closePromises = this.browsers.map(async (browser, index) => {
        try {
          if (browser.connected) {
            await browser.close();
            this.logger.debug(`Browser ${index + 1} closed successfully`);
          }
        } catch (error) {
          const errorMessage =
            error && typeof error === 'object' && 'message' in error
              ? (error as Error).message
              : 'Unknown error';
          this.logger.warn(`Error closing browser ${index + 1}: ${errorMessage}`);
        }
      });

      await Promise.all(closePromises);
      this.browsers = [];
      this.isInitialized = false;

      this.logger.log('Browser pool closed successfully');
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as Error).message
          : 'Unknown error';
      this.logger.error(`Error during browser pool cleanup: ${errorMessage}`);
    }
  }
}
