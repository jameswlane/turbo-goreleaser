import * as core from '@actions/core'
import { GITHUB_API_CACHE_TTL, GITHUB_API_RATE_LIMIT_RETRY_AFTER } from './constants'

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

interface RateLimitInfo {
  remaining: number
  reset: number
  limit: number
}

/**
 * Simple in-memory cache for API responses
 */
export class ApiCache {
  private cache: Map<string, CacheEntry<any>> = new Map()
  private rateLimitInfo: RateLimitInfo | null = null

  /**
   * Get cached data if available and not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key)

    if (!entry) {
      core.debug(`Cache miss for key: ${key}`)
      return null
    }

    const now = Date.now()
    if (now - entry.timestamp > entry.ttl) {
      core.debug(`Cache expired for key: ${key}`)
      this.cache.delete(key)
      return null
    }

    core.debug(`Cache hit for key: ${key}`)
    return entry.data as T
  }

  /**
   * Store data in cache
   */
  set<T>(key: string, data: T, ttl: number = GITHUB_API_CACHE_TTL): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    })
    core.debug(`Cached data for key: ${key} with TTL: ${ttl}ms`)
  }

  /**
   * Get or fetch data with caching
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = GITHUB_API_CACHE_TTL
  ): Promise<T> {
    const cached = this.get<T>(key)
    if (cached !== null) {
      return cached
    }

    const data = await fetcher()
    this.set(key, data, ttl)
    return data
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear()
    core.debug('Cache cleared')
  }

  /**
   * Clear expired entries
   */
  cleanup(): void {
    const now = Date.now()
    const keysToDelete: string[] = []

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key)
    }

    if (keysToDelete.length > 0) {
      core.debug(`Cleaned up ${keysToDelete.length} expired cache entries`)
    }
  }

  /**
   * Update rate limit information from GitHub API response headers
   */
  updateRateLimit(remaining: number, reset: number, limit: number): void {
    this.rateLimitInfo = { remaining, reset, limit }
    core.debug(
      `Rate limit updated: ${remaining}/${limit}, resets at ${new Date(reset * 1000).toISOString()}`
    )
  }

  /**
   * Check if we should wait due to rate limiting
   */
  async waitForRateLimit(): Promise<void> {
    if (!this.rateLimitInfo) {
      return
    }

    const { remaining, reset } = this.rateLimitInfo

    if (remaining <= 1) {
      const now = Date.now() / 1000
      const waitTime = Math.max(0, (reset - now) * 1000)

      if (waitTime > 0) {
        core.warning(
          `GitHub API rate limit nearly exhausted. Waiting ${Math.round(waitTime / 1000)} seconds...`
        )
        await new Promise(resolve =>
          setTimeout(resolve, Math.min(waitTime, GITHUB_API_RATE_LIMIT_RETRY_AFTER))
        )
      }
    }
  }

  /**
   * Check if rate limit is approaching
   */
  isRateLimitApproaching(): boolean {
    if (!this.rateLimitInfo) {
      return false
    }

    return this.rateLimitInfo.remaining < 10
  }
}

// Global cache instance
export const apiCache = new ApiCache()

/**
 * Decorator for caching async function results
 */
export function cached<T extends (...args: any[]) => Promise<any>>(
  keyGenerator: (...args: Parameters<T>) => string,
  ttl: number = GITHUB_API_CACHE_TTL
) {
  return function (
    _target: any,
    _propertyName: string,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value!

    descriptor.value = async function (this: any, ...args: Parameters<T>): Promise<ReturnType<T>> {
      const key = keyGenerator(...args)
      return apiCache.getOrFetch(key, () => originalMethod.apply(this, args), ttl)
    } as T

    return descriptor
  }
}
