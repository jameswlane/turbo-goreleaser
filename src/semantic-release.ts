import * as core from '@actions/core'
import * as exec from '@actions/exec'
import conventionalCommitsParser from 'conventional-commits-parser'
import * as semver from 'semver'
import type { Commit, Package, PackageVersion } from './types'

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
        const { stdout } = await exec.getExecOutput('git', ['describe', '--tags', '--abbrev=0'])
        lastTag = stdout.trim()
      } catch {
        // No tags found, will get all commits
        core.debug('No previous tags found, analyzing all commits')
      }

      // Get commits since last tag (or all commits if no tag)
      // Limit to 1000 commits to prevent memory issues in large repos
      const args = lastTag
        ? ['log', `${lastTag}..HEAD`, '--pretty=format:%H|||%s|||%b', '--max-count=1000']
        : ['log', '--pretty=format:%H|||%s|||%b', '--max-count=1000']

      const { stdout } = await exec.getExecOutput('git', args)
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

    for (const commit of commits) {
      try {
        // Check if commit affects package files
        const { stdout } = await exec.getExecOutput('git', [
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-r',
          commit.sha
        ])

        const files = stdout
          .trim()
          .split('\n')
          .filter(f => f)

        const affectsPackage = files.some(file => {
          // Check if file is in package directory
          return file.startsWith(`${pkg.path}/`)
        })

        if (affectsPackage) {
          relevantCommits.push(commit)
        }
      } catch (error) {
        // If git diff-tree fails, fall back to scope matching
        core.debug(`Failed to get files for commit ${commit.sha}: ${error}`)
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
