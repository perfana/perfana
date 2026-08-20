import { z } from 'zod'

// Authentication schemas
export const signInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const signUpSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
})

// API Keys schemas
export const createApiKeySchema = z.object({
  description: z.string().min(1, 'Description is required').max(255, 'Description must be less than 255 characters'),
  ttl: z.string().min(1, 'Time to live is required'),
  organizationId: z.string().uuid('Invalid organization ID').optional(),
})

// Grafana Instance schemas
export const createGrafanaInstanceSchema = z.object({
  label: z.string().min(1, 'Label is required').max(255, 'Label must be less than 255 characters'),
  clientUrl: z.string().url('Invalid URL format'),
  serverUrl: z.string().url('Invalid URL format').optional().or(z.literal('')),
  orgId: z.string().min(1, 'Organization ID is required').max(50, 'Organization ID must be less than 50 characters'),
  apiKey: z.string().optional(),
  username: z.string().max(255, 'Username must be less than 255 characters').optional(),
  password: z.string().optional(),
  snapshotInstance: z.boolean().optional(),
  useProxy: z.boolean().optional(),
}).refine(_data => {
  // Either API key or username/password should be provided, but not required
  return true
}, {
  message: 'Either API key or username/password should be provided',
})

// Dynatrace Configuration schemas
export const createDynatraceConfigSchema = z.object({
  label: z.string().min(1, 'Label is required').max(255, 'Label must be less than 255 characters'),
  host: z.string()
    .min(1, 'Host URL is required')
    .refine(
      (val) => {
        try {
          new URL(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid URL format' }
    ),
  apiToken: z.string()
    .min(1, 'API token is required')
    .min(10, 'API token must be at least 10 characters'),
  platformApiToken: z.string().optional(),
  dynatraceType: z.enum(['saas', 'managed']).optional().default('saas'),
  useProxy: z.boolean().optional(),
})

// Pyroscope Instance schemas
export const createPyroscopeInstanceSchema = z.object({
  label: z.string().min(1, 'Label is required').max(255, 'Label must be less than 255 characters'),
  pyroscopeUrl: z.string().url('Invalid URL format'),
  backendUrl: z.string().url('Invalid URL format').optional().or(z.literal('')),
  pyroscopeStandAlone: z.boolean().optional(),
  useProxy: z.boolean().optional(),
})

// Tracing Instance schemas
export const createTracingInstanceSchema = z.object({
  label: z.string().min(1, 'Label is required').max(255, 'Label must be less than 255 characters'),
  tracingUrl: z.string().url('Invalid URL format'),
  tracingApiUrl: z.string().url('Invalid URL format').optional().or(z.literal('')),
  tracingUi: z.enum(['tempo', 'jaeger', 'elastic']),
  tracingIframeAllowed: z.boolean(),
  useProxy: z.boolean().optional(),
})

// Form field error helper
export type FieldError = {
  message?: string
}

export type FormErrors<T> = Partial<Record<keyof T, FieldError>>

// Type inference helpers
export type SignInFormData = z.infer<typeof signInSchema>
export type SignUpFormData = z.infer<typeof signUpSchema>
export type CreateApiKeyFormData = z.infer<typeof createApiKeySchema>
export type CreateGrafanaInstanceFormData = z.infer<typeof createGrafanaInstanceSchema>
export type CreateDynatraceConfigFormData = z.infer<typeof createDynatraceConfigSchema>
/**
 * The pre-parse shape. `dynatraceType` is `.optional().default('saas')`, so zod's input
 * and output types differ: the field is optional going in and present coming out.
 * `useForm` needs the input type for its field values and the output type for what the
 * resolver produces — see useDynatraceIntegration.
 */
export type CreateDynatraceConfigFormInput = z.input<typeof createDynatraceConfigSchema>
export type CreatePyroscopeInstanceFormData = z.infer<typeof createPyroscopeInstanceSchema>
export type CreateTracingInstanceFormData = z.infer<typeof createTracingInstanceSchema>