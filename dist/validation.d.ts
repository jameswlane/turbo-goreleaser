/**
 * Sanitizes package names to prevent command injection
 */
export declare function sanitizePackageName(packageName: string): string;
/**
 * Validates and sanitizes Git tag names
 */
export declare function sanitizeTagName(tagName: string): string;
/**
 * Validates and sanitizes file paths to prevent path traversal
 */
export declare function sanitizePath(inputPath: string, workspaceRoot: string): string;
/**
 * Validates Git references (branches, commits, etc.)
 */
export declare function sanitizeGitRef(ref: string): string;
/**
 * Validates command arguments to prevent injection
 */
export declare function sanitizeCommandArgs(args: string[]): string[];
/**
 * Validates working directory input
 */
export declare function validateWorkingDirectory(dir: string): string;
/**
 * Creates a safe exec options object with validated paths
 */
export declare function createSafeExecOptions(cwd?: string): {
    cwd: string;
};
/**
 * Logs potentially sensitive values with masking
 */
export declare function logSafely(message: string, sensitive?: string[]): void;
