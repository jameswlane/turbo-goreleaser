import * as core from '@actions/core'
import {
  EXPONENTIAL_BACKOFF_BASE,
  EXPONENTIAL_BACKOFF_MAX_DELAY,
  EXPONENTIAL_BACKOFF_JITTER,
  GITHUB_API_MAX_RETRIES
} from './constants'

export interface RetryOptions {
  maxAttempts?: number
  initialDelay?: number
  maxDelay?: number
  backoffBase?: number
  jitter?: boolean
  onRetry?: (error: Error, attempt: number) => void
}

/**
 * Execute a function with exponential backoff retry logic
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = GITHUB_API_MAX_RETRIES,
    initialDelay = 1000,
    maxDelay = EXPONENTIAL_BACKOFF_MAX_DELAY,
    backoffBase = EXPONENTIAL_BACKOFF_BASE,
    jitter = true,
    onRetry
  } = options

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      if (attempt === maxAttempts) {
        core.error(`Failed after ${maxAttempts} attempts: ${lastError.message}`)
        throw lastError
      }

      // Calculate delay with exponential backoff
      let delay = initialDelay * Math.pow(backoffBase, attempt - 1)

      // Apply jitter if enabled
      if (jitter) {
        const jitterAmount = delay * EXPONENTIAL_BACKOFF_JITTER
        delay = delay + (Math.random() * 2 - 1) * jitterAmount
      }

      // Cap at maximum delay
      delay = Math.min(delay, maxDelay)

      core.debug(`Retry attempt ${attempt}/${maxAttempts} after ${Math.round(delay)}ms delay`)

      if (onRetry) {
        onRetry(lastError, attempt)
      }

      await sleep(delay)
    }
  }

  throw lastError || new Error('Retry failed with unknown error')
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Retry decorator for class methods
 */
export function retry(options: RetryOptions = {}) {
  return function (
    _target: any,
    _propertyName: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const originalMethod = descriptor.value

    descriptor.value = async function (this: any, ...args: any[]) {
      return retryWithBackoff(() => originalMethod.apply(this, args), options)
    }

    return descriptor
  }
}

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase()

  // Network errors
  if (
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('socket hang up')
  ) {
    return true
  }

  // HTTP errors that are retryable
  if (
    message.includes('502') || // Bad Gateway
    message.includes('503') || // Service Unavailable
    message.includes('504') || // Gateway Timeout
    message.includes('429')
  ) {
    // Too Many Requests
    return true
  }

  // Git errors that might be transient
  if (
    message.includes('could not read from remote repository') ||
    message.includes('connection timed out')
  ) {
    return true
  }

  return false
}

/**
 * Wraps a function to only retry on retryable errors
 */
export async function retryOnRetryableErrors<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  return retryWithBackoff(fn, {
    ...options,
    onRetry: (error, attempt) => {
      if (!isRetryableError(error)) {
        throw error // Don't retry non-retryable errors
      }
      if (options.onRetry) {
        options.onRetry(error, attempt)
      }
    }
  })
}
