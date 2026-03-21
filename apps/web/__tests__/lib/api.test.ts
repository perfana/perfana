import { PerfanaError } from '@/lib/errors'

// Mock fetch globally
global.fetch = jest.fn()

describe('API Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // Tests removed as fetchTestRuns has been replaced with direct authenticatedFetch usage
  it('placeholder test - API functions tested in api-auth.test.ts', () => {
    expect(true).toBe(true)
  })
})