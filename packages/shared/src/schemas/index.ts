import { z } from 'zod';

// Organization schemas
export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

// Team schemas
export const teamSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createTeamSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

// Application schemas
export const applicationSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  description: z.string().min(1),
  tracingService: z.string().max(255).optional(),
  pyroscopeApplication: z.string().max(255).optional(),
  pyroscopeProfiler: z.string().max(255).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createApplicationSchema = z.object({
  teamId: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  description: z.string().min(1),
  tracingService: z.string().max(255).optional(),
  pyroscopeApplication: z.string().max(255).optional(),
  pyroscopeProfiler: z.string().max(255).optional(),
});

// Test run schemas
export const testRunSchema = z.object({
  id: z.string().uuid(),
  applicationId: z.string().uuid(),
  testEnvironment: z.string().min(1).max(255),
  testType: z.string().min(1).max(255),
  testRunId: z.string().min(1).max(255),
  startTime: z.date().optional(),
  endTime: z.date().optional(),
  duration: z.number().int().optional(),
  plannedDuration: z.number().int().optional(),
  rampUp: z.number().int().optional(),
  completed: z.boolean().default(false),
  abort: z.boolean().default(false),
  status: z.record(z.any()).optional(),
  consolidatedResult: z.record(z.any()).optional(),
  annotations: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  applicationRelease: z.string().max(255).optional(),
  ciBuildResultsUrl: z.string().url().optional(),
  expires: z.date().optional(),
  expired: z.boolean().default(false),
  valid: z.boolean().default(true),
  reasonsNotValid: z.array(z.string()).optional(),
  adaptConfig: z.record(z.any()).optional(),
  variables: z.record(z.any()).optional(),
  deepLinks: z.record(z.any()).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createTestRunSchema = z.object({
  applicationId: z.string().uuid(),
  testEnvironment: z.string().min(1).max(255),
  testType: z.string().min(1).max(255),
  testRunId: z.string().min(1).max(255),
  startTime: z.date().optional(),
  endTime: z.date().optional(),
  duration: z.number().int().optional(),
  plannedDuration: z.number().int().optional(),
  rampUp: z.number().int().optional(),
  annotations: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  applicationRelease: z.string().max(255).optional(),
  ciBuildResultsUrl: z.string().url().optional(),
  variables: z.record(z.any()).optional(),
});

// Benchmark schemas
export const benchmarkSchema = z.object({
  id: z.string().uuid(),
  applicationId: z.string().uuid(),
  testEnvironment: z.string().min(1).max(255),
  testType: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  hasAbsoluteCheck: z.boolean().default(true),
  hasComparisonCheck: z.boolean().default(true),
  requirement: z.record(z.any()).optional(),
  benchmarkThreshold: z.record(z.any()).optional(),
  comparisonStrategy: z.string().max(100).default('previous'),
  evaluationConfig: z.record(z.any()).optional(),
  isActive: z.boolean().default(true),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createBenchmarkSchema = z.object({
  applicationId: z.string().uuid(),
  testEnvironment: z.string().min(1).max(255),
  testType: z.string().min(1).max(255),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  hasAbsoluteCheck: z.boolean().default(true),
  hasComparisonCheck: z.boolean().default(true),
  requirement: z.record(z.any()).optional(),
  benchmarkThreshold: z.record(z.any()).optional(),
  comparisonStrategy: z.string().max(100).default('previous'),
  evaluationConfig: z.record(z.any()).optional(),
});

// API response schemas
export const apiResponseSchema = z.object({
  data: z.any().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  success: z.boolean(),
});

export const paginatedResponseSchema = z.object({
  data: z.array(z.any()),
  pagination: z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  }),
  success: z.boolean(),
});

// Query parameter schemas
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const filterSchema = z.object({
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});