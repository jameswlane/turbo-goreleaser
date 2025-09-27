/**
 * Simple in-memory cache for API responses
 */
export declare class ApiCache {
    private cache;
    private rateLimitInfo;
    /**
     * Get cached data if available and not expired
     */
    get<T>(key: string): T | null;
    /**
     * Store data in cache
     */
    set<T>(key: string, data: T, ttl?: number): void;
    /**
     * Get or fetch data with caching
     */
    getOrFetch<T>(key: string, fetcher: () => Promise<T>, ttl?: number): Promise<T>;
    /**
     * Clear all cached data
     */
    clear(): void;
    /**
     * Clear expired entries
     */
    cleanup(): void;
    /**
     * Update rate limit information from GitHub API response headers
     */
    updateRateLimit(remaining: number, reset: number, limit: number): void;
    /**
     * Check if we should wait due to rate limiting
     */
    waitForRateLimit(): Promise<void>;
    /**
     * Check if rate limit is approaching
     */
    isRateLimitApproaching(): boolean;
}
export declare const apiCache: ApiCache;
/**
 * Decorator for caching async function results
 */
export declare function cached<T extends (...args: any[]) => Promise<any>>(keyGenerator: (...args: Parameters<T>) => string, ttl?: number): (_target: any, _propertyName: string, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<T>;
