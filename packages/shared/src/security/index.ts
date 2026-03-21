/**
 * Security utilities for protecting against common web vulnerabilities
 *
 * This module provides utilities for:
 * - SSRF (Server-Side Request Forgery) prevention via URL validation
 *
 * IMPORTANT: Always use these utilities when:
 * - Making HTTP requests to user-provided URLs
 * - Embedding external content in iframes
 * - Redirecting users to external URLs
 */

export * from './url-validator';
