// API and Network Constants
export const GITHUB_API_RATE_LIMIT_RETRY_AFTER = 60000 // 1 minute
export const GITHUB_API_MAX_RETRIES = 3
export const GITHUB_API_CACHE_TTL = 300000 // 5 minutes
export const GITHUB_API_PER_PAGE = 100
export const GITHUB_API_MAX_PAGES = 10

// Git Operation Constants
export const MAX_COMMITS_TO_ANALYZE = 1000
export const COMMIT_BATCH_SIZE = 50
export const GIT_PUSH_MAX_RETRIES = 3
export const GIT_PUSH_RETRY_DELAY = 1000 // Initial delay for exponential backoff

// Concurrency and Performance
export const MAX_CONCURRENT_OPERATIONS = 5
export const DEFAULT_EXEC_TIMEOUT = 60000 // 1 minute
export const LONG_RUNNING_EXEC_TIMEOUT = 300000 // 5 minutes

// File System Constants
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
export const CHANGELOG_MAX_LENGTH = 65536 // 64KB

// Release Constants
export const DEFAULT_RELEASE_BRANCH = 'main'
export const VALID_RELEASE_TYPES = ['major', 'minor', 'patch', 'prerelease'] as const
export const PRERELEASE_IDENTIFIER = 'alpha'

// Retry Strategy Constants
export const EXPONENTIAL_BACKOFF_BASE = 2
export const EXPONENTIAL_BACKOFF_MAX_DELAY = 30000 // 30 seconds
export const EXPONENTIAL_BACKOFF_JITTER = 0.1 // 10% jitter

// Validation Constants
export const MIN_NODE_VERSION = 20
export const REQUIRED_NODE_VERSION_MESSAGE = 'This action requires Node.js version 20 or higher'
