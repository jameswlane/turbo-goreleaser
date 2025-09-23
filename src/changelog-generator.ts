import * as core from '@actions/core'
import type { Context } from '@actions/github/lib/context'
import type { Commit, Octokit, PackageVersion } from './types'
import { apiCache } from './cache'
import { retryOnRetryableErrors } from './retry'
import { GITHUB_API_MAX_RETRIES, MAX_CONCURRENT_OPERATIONS } from './constants'

export interface ChangelogGeneratorConfig {
  octokit: Octokit
  context: Context
}

interface GroupedCommits {
  breaking: Commit[]
  features: Commit[]
  fixes: Commit[]
  other: Commit[]
}

export class ChangelogGenerator {
  private octokit: Octokit
  private context: Context

  constructor(config: ChangelogGeneratorConfig) {
    this.octokit = config.octokit
    this.context = config.context
  }

  async generate(packageVersions: PackageVersion[]): Promise<Map<string, string>> {
    const changelogs = new Map<string, string>()

    for (const packageVersion of packageVersions) {
      const changelog = await this.generatePackageChangelog(packageVersion)
      changelogs.set(packageVersion.name, changelog)
    }

    return changelogs
  }

  public async generatePackageChangelog(packageVersion: PackageVersion): Promise<string> {
    const { name, currentVersion, newVersion, commits } = packageVersion

    // Group commits by type
    const grouped = this.groupCommits(commits)

    // Build changelog sections
    const sections: string[] = [
      `## ${name} v${newVersion}`,
      '',
      this.generateComparisonLink(currentVersion, newVersion, packageVersion),
      ''
    ]

    // Add a breaking changes section
    if (grouped.breaking.length > 0) {
      sections.push('### 🚨 Breaking Changes')
      sections.push('')
      grouped.breaking.forEach(commit => {
        sections.push(this.formatCommit(commit))
      })
      sections.push('')
    }

    // Add a features section
    if (grouped.features.length > 0) {
      sections.push('### 🚀 Features')
      sections.push('')
      grouped.features.forEach(commit => {
        sections.push(this.formatCommit(commit))
      })
      sections.push('')
    }

    // Add a fixes section
    if (grouped.fixes.length > 0) {
      sections.push('### 🐛 Bug Fixes')
      sections.push('')
      grouped.fixes.forEach(commit => {
        sections.push(this.formatCommit(commit))
      })
      sections.push('')
    }

    // Add other changes section if there are any
    if (grouped.other.length > 0) {
      sections.push('### 🛠️ Other Changes')
      sections.push('')
      grouped.other.forEach(commit => {
        sections.push(this.formatCommit(commit))
      })
      sections.push('')
    }

    // Add a contributors section
    const contributors = await this.getContributors(commits)
    if (contributors.length > 0) {
      sections.push('### 👥 Contributors')
      sections.push('')
      sections.push(contributors.map(c => `- @${c}`).join('\n'))
      sections.push('')
    }

    return sections.join('\n').trim()
  }

  public groupCommits(commits: Commit[]): GroupedCommits {
    const grouped: GroupedCommits = {
      breaking: [],
      features: [],
      fixes: [],
      other: []
    }

    for (const commit of commits) {
      if (commit.breaking) {
        grouped.breaking.push(commit)
      } else if (commit.type === 'feat') {
        grouped.features.push(commit)
      } else if (commit.type === 'fix') {
        grouped.fixes.push(commit)
      } else {
        grouped.other.push(commit)
      }
    }

    return grouped
  }

  public formatCommit(commit: Commit): string {
    const shortSha = commit.sha.substring(0, 7)
    const scope = commit.scope ? `**${commit.scope}:** ` : ''

    // Extract the commit subject (first line)
    const subject = commit.message
      .split('\n')[0]
      .replace(
        /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\([^)]+\))?:\s*/,
        ''
      )

    // Create a GitHub commit link
    const commitUrl = `https://github.com/${this.context.repo.owner}/${this.context.repo.repo}/commit/${commit.sha}`

    return `- ${scope}${subject} ([${shortSha}](${commitUrl}))`
  }

  public generateComparisonLink(
    currentVersion: string,
    newVersion: string,
    packageVersion: PackageVersion
  ): string {
    const { owner, repo } = this.context.repo
    const baseTag = this.getTagName(packageVersion.name, currentVersion)
    const headTag = this.getTagName(packageVersion.name, newVersion)

    // Handle first release
    if (currentVersion === '0.0.0' || !currentVersion) {
      return `**Full Changelog**: https://github.com/${owner}/${repo}/commits/${headTag}`
    }

    return `**Full Changelog**: https://github.com/${owner}/${repo}/compare/${baseTag}...${headTag}`
  }

  public getTagName(packageName: string, version: string): string {
    // This should match the tag format used by TagManager
    // For now, using slash format as default
    const cleanName = packageName.replace('@', '').replace(/\//g, '-')
    return `${cleanName}/v${version}`
  }

  public async getContributors(commits: Commit[]): Promise<string[]> {
    const contributors = new Set<string>()

    try {
      // Get unique commit SHAs
      const shas = [...new Set(commits.map(c => c.sha))]

      // Process commits in batches with rate limiting
      const batchSize = MAX_CONCURRENT_OPERATIONS
      for (let i = 0; i < shas.length; i += batchSize) {
        const batch = shas.slice(i, i + batchSize)

        // Check rate limit before batch
        await apiCache.waitForRateLimit()

        const batchPromises = batch.map(async sha => {
          const cacheKey = `commit:${this.context.repo.owner}:${this.context.repo.repo}:${sha}`

          try {
            const commit = await apiCache.getOrFetch(cacheKey, async () => {
              const result = await retryOnRetryableErrors(
                async () => {
                  const { data, headers } = await this.octokit.rest.repos.getCommit({
                    owner: this.context.repo.owner,
                    repo: this.context.repo.repo,
                    ref: sha
                  })

                  // Update rate limit info from headers
                  if (headers['x-ratelimit-remaining'] && headers['x-ratelimit-reset']) {
                    apiCache.updateRateLimit(
                      Number.parseInt(headers['x-ratelimit-remaining'] as string),
                      Number.parseInt(headers['x-ratelimit-reset'] as string),
                      Number.parseInt((headers['x-ratelimit-limit'] as string) || '60')
                    )
                  }

                  return data
                },
                {
                  maxAttempts: GITHUB_API_MAX_RETRIES,
                  onRetry: (error, attempt) => {
                    core.debug(
                      `Retry ${attempt}/${GITHUB_API_MAX_RETRIES} for commit ${sha}: ${error.message}`
                    )
                  }
                }
              )
              return result
            })

            if (commit.author?.login) {
              contributors.add(commit.author.login)
            }
          } catch (error) {
            core.debug(`Failed to get commit ${sha}: ${error}`)
          }
        })

        await Promise.all(batchPromises)

        // Add delay between batches if rate limit is approaching
        if (apiCache.isRateLimitApproaching() && i + batchSize < shas.length) {
          core.debug('Rate limit approaching, adding delay between batches')
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }
    } catch (error) {
      core.warning(`Failed to get contributors: ${error}`)
    }

    return Array.from(contributors).sort()
  }
}
