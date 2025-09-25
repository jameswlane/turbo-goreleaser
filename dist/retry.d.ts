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
export declare function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T>
/**
 * Sleep for specified milliseconds
 */
export declare function sleep(ms: number): Promise<void>
/**
 * Retry decorator for class methods
 */
export declare function retry(
  options?: RetryOptions
): (_target: any, _propertyName: string, descriptor: PropertyDescriptor) => PropertyDescriptor
/**
 * Check if an error is retryable
 */
export declare function isRetryableError(error: Error): boolean
/**
 * Wraps a function to only retry on retryable errors
 */
export declare function retryOnRetryableErrors<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T>
