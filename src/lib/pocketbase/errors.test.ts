import { describe, it, expect, vi } from 'vitest'
import * as errorsModule from './errors'
import { safePbQuery, safePbFullList } from './resilient'
import { ClientResponseError } from 'pocketbase'

describe('pocketbase/errors export guard', () => {
  it('must export isNetworkError, isRateLimitError, parseRetryAfterMs, extractFieldErrors and getErrorMessage', () => {
    expect(errorsModule).toHaveProperty('isNetworkError')
    expect(typeof errorsModule.isNetworkError).toBe('function')
    expect(errorsModule).toHaveProperty('isRateLimitError')
    expect(typeof errorsModule.isRateLimitError).toBe('function')
    expect(errorsModule).toHaveProperty('parseRetryAfterMs')
    expect(typeof errorsModule.parseRetryAfterMs).toBe('function')
    expect(errorsModule).toHaveProperty('extractFieldErrors')
    expect(typeof errorsModule.extractFieldErrors).toBe('function')
    expect(errorsModule).toHaveProperty('getErrorMessage')
    expect(typeof errorsModule.getErrorMessage).toBe('function')
  })

  it('isNetworkError correctly identifies network, status 0 and abort errors', () => {
    expect(errorsModule.isNetworkError(new ClientResponseError({ status: 0 }))).toBe(true)
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

  it('identifies 429 rate limit errors and retry-after header', () => {
    expect(errorsModule.isRateLimitError({ status: 429 })).toBe(true)
    expect(errorsModule.isRateLimitError(new Error('Too Many Requests (429)'))).toBe(true)
    expect(errorsModule.isRateLimitError(new Error('Validation error'))).toBe(false)

    const errorWithHeader = {
      response: {
        headers: { 'retry-after': '2' },
      },
    }
    expect(errorsModule.parseRetryAfterMs(errorWithHeader)).toBe(2000)

    // Clamping min 500ms and max 30000ms
    const tooSmall = { response: { headers: { 'retry-after': '0.1' } } }
    expect(errorsModule.parseRetryAfterMs(tooSmall)).toBe(500)

    const tooBig = { response: { headers: { 'retry-after': '60' } } }
    expect(errorsModule.parseRetryAfterMs(tooBig)).toBe(30000)

    // Fallback when missing
    expect(errorsModule.parseRetryAfterMs({}, 1500)).toBe(1500)
  })
})

describe('resilient pocketbase wrapper', () => {
  it('safePbQuery catches error and returns fallback silently without throwing', async () => {
    const failingFn = vi.fn().mockRejectedValue(new Error('HTTP 429 Too Many Requests'))
    const result = await safePbQuery(failingFn, {
      fallback: ['fallback_item'],
      maxRetries: 0,
      timeoutMs: 500,
    })
    expect(result).toEqual(['fallback_item'])
  })

  it('safePbQuery performs at most 1 retry on 429 then returns fallback', async () => {
    let calls = 0
    const fn429 = vi.fn().mockImplementation(async () => {
      calls++
      const err = new Error('429 rate limit')
      ;(err as any).status = 429
      throw err
    })

    const res = await safePbQuery(fn429, {
      fallback: [],
      maxRetries: 1,
      timeoutMs: 1000,
    })
    expect(calls).toBe(2)
    expect(res).toEqual([])
  })
})
