// CRITICAL: Must be the very first import for TypeORM decorators to work
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { INestApplicationContext, LogLevel } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { getLogger } from './lib/utils/logger.js';

const logger = getLogger('nestjs-bootstrap');

/**
 * NestJS Application Context Bootstrap
 *
 * Creates a NestJS application context for the worker application.
 * This allows us to use dependency injection and TypeORM repositories
 * without running an HTTP server.
 *
 * Pattern:
 * - Uses NestFactory.createApplicationContext() instead of create()
 * - No HTTP server (worker only needs DI and database access)
 * - Returns context that can be used to resolve services/repositories
 */

let appContext: INestApplicationContext | null = null;

/**
 * Initialize the NestJS application context
 * Should be called once at worker startup
 */
export async function bootstrapNestJS(): Promise<INestApplicationContext> {
  if (appContext) {
    return appContext;
  }

  try {
    logger.info('Initializing NestJS application context...');

    // Keep error/warn logging in production for visibility into initialization failures
    // In development, include 'log' level for debugging framework initialization
    const isProduction = process.env.NODE_ENV === 'production';
    const nestLoggerConfig: false | LogLevel[] = isProduction
      ? ['error', 'warn']
      : ['error', 'warn', 'log'];

    // Create application context (no HTTP server)
    appContext = await NestFactory.createApplicationContext(AppModule, {
      logger: nestLoggerConfig,
    });

    logger.info('✅ NestJS application context initialized successfully');
    return appContext;
  } catch (error) {
    logger.error('❌ Failed to initialize NestJS application context:', error);
    throw error;
  }
}

/**
 * Get the NestJS application context
 * Returns null if not initialized
 */
export function getNestJSContext(): INestApplicationContext | null {
  return appContext;
}

/**
 * Get a service from the NestJS application context
 * Throws error if context not initialized
 */
export function getService<T>(serviceClass: abstract new (...args: never) => T): T {
  if (!appContext) {
    throw new Error('NestJS application context not initialized. Call bootstrapNestJS() first.');
  }

  return appContext.get(serviceClass);
}

/**
 * Close the NestJS application context
 * Should be called on graceful shutdown
 */
export async function shutdownNestJS(): Promise<void> {
  if (appContext) {
    logger.info('Closing NestJS application context...');
    await appContext.close();
    appContext = null;
    logger.info('✅ NestJS application context closed');
  }
}
