import * as core from '@actions/core'
import * as exec from '@actions/exec'
import conventionalCommitsParser from 'conventional-commits-parser'
import * as semver from 'semver'
import type { Commit, Package, PackageVersion } from './types'
import { sanitizeGitRef, createSafeExecOptions } from './validation'
import { MAX_COMMITS_TO_ANALYZE, COMMIT_BATCH_SIZE } from './constants'

export interface SemanticReleaseConfig {
  enabled: boolean
  types?: Record<string, string>
}

const DEFAULT_TYPES: Record<string, string> = {
  feat: 'minor',
  fix: 'patch',
  perf: 'patch',
  revert: 'patch',
  docs: 'patch',
  style: 'patch',
  refactor: 'patch',
  test: 'patch',
  build: 'patch',
  ci: 'patch',
  chore: 'patch'
}

export class SemanticReleaseParser {
  private types: Record<string, string>
  private enabled: boolean

  constructor(config: SemanticReleaseConfig) {
    this.enabled = config.enabled
    this.types = config.types || DEFAULT_TYPES
  }

  async analyzeCommits(packages: Package[]): Promise<PackageVersion[]> {
    const commits = await this.getCommits()
    const packageVersions: PackageVersion[] = []

    for (const pkg of packages) {
      const relevantCommits = await this.filterCommitsForPackage(commits, pkg)
      const releaseType = this.determineReleaseType(relevantCommits)

      if (releaseType) {
        const currentVersion = pkg.version || '0.0.0'
        const newVersion = semver.inc(currentVersion, releaseType)

        if (newVersion && this.isValidVersionUpgrade(currentVersion, newVersion)) {
          packageVersions.push({
            ...pkg,
            currentVersion,
            newVersion,
            releaseType,
            commits: relevantCommits
          })
        } else if (newVersion) {
          core.warning(
            `Skipping ${pkg.name}: new version ${newVersion} is not greater than current ${currentVersion}`
          )
        }
      }
    }

    return packageVersions
  }

  private async getCommits(): Promise<Commit[]> {
    const commits: Commit[] = []

    try {
      // Get the latest tag
      let lastTag = ''
      try {
        const { stdout } = await exec.getExecOutput(
          'git',
          ['describe', '--tags', '--abbrev=0'],
          createSafeExecOptions()
        )
        lastTag = stdout.trim()
      } catch (error) {
        // No tags found, will get all commits
        core.debug(`No previous tags found, analyzing all commits: ${error}`)
      }

      // Get commits since last tag (or all commits if no tag)
      // Limit commits to prevent memory issues in large repos
      const args = lastTag
        ? [
            'log',
            `${sanitizeGitRef(lastTag)}..HEAD`,
            '--pretty=format:%H|||%s|||%b',
            `--max-count=${MAX_COMMITS_TO_ANALYZE}`
          ]
        : ['log', '--pretty=format:%H|||%s|||%b', `--max-count=${MAX_COMMITS_TO_ANALYZE}`]

      const { stdout } = await exec.getExecOutput('git', args, createSafeExecOptions())
      const lines = stdout
        .trim()
        .split('\n')
        .filter(line => line)

      for (const line of lines) {
        const [sha, subject, body = ''] = line.split('|||')
        const message = `${subject}\n\n${body}`.trim()

        if (this.enabled) {
          const parsed = conventionalCommitsParser.sync(message)
          commits.push({
            sha,
            message,
            type: parsed.type || undefined,
            scope: parsed.scope || undefined,
            breaking: !!parsed.notes?.some(
              (note: { title: string }) => note.title === 'BREAKING CHANGE'
            )
          })
        } else {
          commits.push({ sha, message })
        }
      }
    } catch (error) {
      core.warning(`Failed to get commits: ${error}`)
    }

    return commits
  }

  private async filterCommitsForPackage(commits: Commit[], pkg: Package): Promise<Commit[]> {
    const relevantCommits: Commit[] = []

    // Get all affected files for all commits in batch
    const commitFileMap = await this.getCommitFilesBatch(commits)

    for (const commit of commits) {
      const files = commitFileMap.get(commit.sha) || []
      const affectsPackage = files.some(file => {
        // Check if file is in package directory
        return file.startsWith(`${pkg.path}/`)
      })

      if (affectsPackage) {
        relevantCommits.push(commit)
      }

      // Also check if commit scope matches package name
      if (commit.scope && this.isPackageScope(commit.scope, pkg.name)) {
        if (!relevantCommits.find(c => c.sha === commit.sha)) {
          relevantCommits.push(commit)
        }
      }
    }

    return relevantCommits
  }

  private async getCommitFilesBatch(commits: Commit[]): Promise<Map<string, string[]>> {
    const commitFileMap = new Map<string, string[]>()

    // Process commits in batches to avoid command line length limits
    const batchSize = COMMIT_BATCH_SIZE
    for (let i = 0; i < commits.length; i += batchSize) {
      const batch = commits.slice(i, i + batchSize)

      try {
        // Validate SHA values before using them
        const validatedShas = batch.map(c => sanitizeGitRef(c.sha))
        const { stdout } = await exec.getExecOutput(
          'git',
          ['diff-tree', '--no-commit-id', '--name-only', '-r', ...validatedShas],
          createSafeExecOptions()
        )

        // Parse the batch output
        const lines = stdout
          .trim()
          .split('\n')
          .filter(line => line)
        let currentCommitIndex = 0
        let currentCommit = batch[currentCommitIndex]

        for (const line of lines) {
          // If line doesn't start with a path character, it's likely a new commit boundary
          if (line.includes(' ') || !line.includes('/')) {
            currentCommitIndex++
            currentCommit = batch[currentCommitIndex]
            continue
          }

          if (currentCommit) {
            const files = commitFileMap.get(currentCommit.sha) || []
            files.push(line)
            commitFileMap.set(currentCommit.sha, files)
          }
        }
      } catch (error) {
        // Fall back to individual processing for this batch
        core.debug(`Batch file processing failed, falling back to individual: ${error}`)
        for (const commit of batch) {
          try {
            const { stdout } = await exec.getExecOutput(
              'git',
              ['diff-tree', '--no-commit-id', '--name-only', '-r', sanitizeGitRef(commit.sha)],
              createSafeExecOptions()
            )
            const files = stdout
              .trim()
              .split('\n')
              .filter(f => f)
            commitFileMap.set(commit.sha, files)
          } catch (individualError) {
            core.debug(`Failed to check files for commit ${commit.sha}: ${individualError}`)
            commitFileMap.set(commit.sha, [])
          }
        }
      }
    }

    return commitFileMap
  }

  private isPackageScope(scope: string, packageName: string): boolean {
    // Handle scoped packages like @org/package
    const simpleName = packageName.split('/').pop() || packageName
    return scope === packageName || scope === simpleName
  }

  private determineReleaseType(commits: Commit[]): 'major' | 'minor' | 'patch' | null {
    if (!this.enabled) {
      // Default to patch if conventional commits are disabled
      return commits.length > 0 ? 'patch' : null
    }

    let releaseType: 'major' | 'minor' | 'patch' | null = null

    for (const commit of commits) {
      // Check for breaking changes
      if (commit.breaking || commit.message.includes('BREAKING CHANGE')) {
        return 'major'
      }

      // Check commit type
      if (commit.type) {
        const typeRelease = this.types[commit.type]
        if (typeRelease === 'minor') {
          releaseType = 'minor'
        } else if (typeRelease === 'patch' && releaseType !== 'minor') {
          releaseType = 'patch'
        }
      }
    }

    return releaseType
  }

  private isValidVersionUpgrade(currentVersion: string, newVersion: string): boolean {
    try {
      return semver.gt(newVersion, currentVersion)
    } catch (error) {
      core.warning(`Invalid version comparison: ${currentVersion} -> ${newVersion}: ${error}`)
      return false
    }
  }
}
