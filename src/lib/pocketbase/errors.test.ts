import { describe, it, expect } from 'vitest'
import * as errorsModule from './errors'

describe('pocketbase/errors export guard', () => {
  it('must export isNetworkError to prevent regressions (recurrent issue guard)', () => {
    expect(errorsModule).toHaveProperty('isNetworkError')
    expect(typeof errorsModule.isNetworkError).toBe('function')
  })

  it('isNetworkError correctly identifies network and abort errors', () => {
    expect(errorsModule.isNetworkError(new Error('Failed to fetch'))).toBe(true)
    expect(
      errorsModule.isNetworkError(new Error('NetworkError when attempting to fetch resource')),
    ).toBe(true)
    expect(
      errorsModule.isNetworkError(new Error('AbortError: signal is aborted without reason')),
    ).toBe(true)
    expect(errorsModule.isNetworkError(new Error('Normal validation error'))).toBe(false)
    expect(errorsModule.isNetworkError(null)).toBe(false)
    expect(errorsModule.isNetworkError(undefined)).toBe(false)
  })
})
