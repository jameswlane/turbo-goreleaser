import * as path from 'path'
import * as core from '@actions/core'

// Constants for validation patterns
const SAFE_PACKAGE_NAME_PATTERN = /^[a-zA-Z0-9-_./@]+$/
const SAFE_TAG_PATTERN = /^[a-zA-Z0-9-_./@]+$/
const SAFE_PATH_PATTERN = /^[a-zA-Z0-9._\-\/]+$/
const SAFE_GIT_REF_PATTERN = /^[a-zA-Z0-9-_.\/]+$/

/**
 * Sanitizes package names to prevent command injection
 */
export function sanitizePackageName(packageName: string): string {
  if (!packageName) {
    throw new Error('Package name cannot be empty')
  }

  if (!SAFE_PACKAGE_NAME_PATTERN.test(packageName)) {
    throw new Error(`Invalid package name: ${packageName} contains unsafe characters`)
  }

  // Additional check for scoped packages
  if (packageName.startsWith('@') && !packageName.includes('/')) {
    throw new Error(`Invalid scoped package name: ${packageName}`)
  }

  return packageName
}

/**
 * Validates and sanitizes Git tag names
 */
export function sanitizeTagName(tagName: string): string {
  if (!tagName) {
    throw new Error('Tag name cannot be empty')
  }

  if (!SAFE_TAG_PATTERN.test(tagName)) {
    throw new Error(`Invalid tag name: ${tagName} contains unsafe characters`)
  }

  // Prevent special git refs
  if (tagName === 'HEAD' || tagName.startsWith('refs/')) {
    throw new Error(`Invalid tag name: ${tagName} is a reserved git reference`)
  }

  return tagName
}

/**
 * Validates and sanitizes file paths to prevent path traversal
 */
export function sanitizePath(inputPath: string, workspaceRoot: string): string {
  if (!inputPath) {
    throw new Error('Path cannot be empty')
  }

  // Normalize the path
  const normalizedPath = path.normalize(inputPath)

  // Check for path traversal attempts
  if (normalizedPath.includes('..') || normalizedPath.startsWith('/')) {
    throw new Error(`Invalid path: ${inputPath} contains path traversal patterns`)
  }

  // Resolve to absolute path within workspace
  const absolutePath = path.resolve(workspaceRoot, normalizedPath)

  // Ensure the path is within the workspace
  if (!absolutePath.startsWith(workspaceRoot)) {
    throw new Error(`Path ${inputPath} is outside the workspace`)
  }

  return absolutePath
}

/**
 * Validates Git references (branches, commits, etc.)
 */
export function sanitizeGitRef(ref: string): string {
  if (!ref) {
    throw new Error('Git reference cannot be empty')
  }

  if (!SAFE_GIT_REF_PATTERN.test(ref)) {
    throw new Error(`Invalid git reference: ${ref} contains unsafe characters`)
  }

  return ref
}

/**
 * Validates command arguments to prevent injection
 */
export function sanitizeCommandArgs(args: string[]): string[] {
  return args.map(arg => {
    // Check for shell metacharacters that could lead to command injection
    if (/[;&|`$<>\\]/.test(arg)) {
      throw new Error(`Unsafe command argument detected: ${arg}`)
    }
    return arg
  })
}

/**
 * Validates working directory input
 */
export function validateWorkingDirectory(dir: string): string {
  if (!dir) {
    return process.cwd()
  }

  if (!SAFE_PATH_PATTERN.test(dir) || dir.includes('..')) {
    throw new Error('Invalid working-directory: contains unsafe characters')
  }

  const resolvedPath = path.resolve(process.cwd(), dir)
  const workspacePath = process.env['GITHUB_WORKSPACE'] || process.cwd()

  if (!resolvedPath.startsWith(workspacePath)) {
    throw new Error('Working directory must be within the workspace')
  }

  return resolvedPath
}

/**
 * Creates a safe exec options object with validated paths
 */
export function createSafeExecOptions(cwd?: string): { cwd: string } {
  const workspacePath = process.env['GITHUB_WORKSPACE'] || process.cwd()

  if (cwd) {
    const safeCwd = sanitizePath(cwd, workspacePath)
    return { cwd: safeCwd }
  }

  return { cwd: workspacePath }
}

/**
 * Logs potentially sensitive values with masking
 */
export function logSafely(message: string, sensitive?: string[]): void {
  let safeMessage = message

  if (sensitive && sensitive.length > 0) {
    for (const value of sensitive) {
      if (value && value.length > 3) {
        const masked = value.substring(0, 3) + '***'
        safeMessage = safeMessage.replace(new RegExp(value, 'g'), masked)
      }
    }
  }

  core.info(safeMessage)
}
