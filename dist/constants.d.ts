export declare const GITHUB_API_RATE_LIMIT_RETRY_AFTER = 60000
export declare const GITHUB_API_MAX_RETRIES = 3
export declare const GITHUB_API_CACHE_TTL = 300000
export declare const GITHUB_API_PER_PAGE = 100
export declare const GITHUB_API_MAX_PAGES = 10
export declare const MAX_COMMITS_TO_ANALYZE = 1000
export declare const COMMIT_BATCH_SIZE = 50
export declare const GIT_PUSH_MAX_RETRIES = 3
export declare const GIT_PUSH_RETRY_DELAY = 1000
export declare const MAX_CONCURRENT_OPERATIONS = 5
export declare const DEFAULT_EXEC_TIMEOUT = 60000
export declare const LONG_RUNNING_EXEC_TIMEOUT = 300000
export declare const MAX_FILE_SIZE_BYTES: number
export declare const CHANGELOG_MAX_LENGTH = 65536
export declare const DEFAULT_RELEASE_BRANCH = 'main'
export declare const VALID_RELEASE_TYPES: readonly ['major', 'minor', 'patch', 'prerelease']
export declare const PRERELEASE_IDENTIFIER = 'alpha'
export declare const EXPONENTIAL_BACKOFF_BASE = 2
export declare const EXPONENTIAL_BACKOFF_MAX_DELAY = 30000
export declare const EXPONENTIAL_BACKOFF_JITTER = 0.1
export declare const MIN_NODE_VERSION = 20
export declare const REQUIRED_NODE_VERSION_MESSAGE =
  'This action requires Node.js version 20 or higher'
