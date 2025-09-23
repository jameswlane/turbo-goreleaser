import * as core from '@actions/core'
import * as exec from '@actions/exec'
import type { Context } from '@actions/github/lib/context'
import type { Octokit, PackageVersion } from './types'

export interface TagManagerConfig {
  octokit: Octokit
  context: Context
  tagFormat: 'npm' | 'slash' | 'standard'
  dryRun: boolean
}

export class TagManager {
  private octokit: Octokit
  private context: Context
  private tagFormat: 'npm' | 'slash' | 'standard'
  private dryRun: boolean

  constructor(config: TagManagerConfig) {
    this.octokit = config.octokit
    this.context = config.context
    this.tagFormat = config.tagFormat
    this.dryRun = config.dryRun
  }

  async createTag(packageVersion: PackageVersion): Promise<string> {
    const tagName = this.formatTag(packageVersion.name, packageVersion.newVersion)

    if (this.dryRun) {
      core.info(`[DRY RUN] Would create tag: ${tagName}`)
      return tagName
    }

    try {
      // Check if tag already exists
      const tagExists = await this.tagExists(tagName)
      if (tagExists) {
        core.warning(`Tag ${tagName} already exists, skipping`)
        return tagName
      }

      // Create the tag locally
      await exec.exec('git', [
        'tag',
        '-a',
        tagName,
        '-m',
        `Release ${packageVersion.name} v${packageVersion.newVersion}`
      ])

      // Push the tag to remote with retry logic
      await this.pushTagWithRetry(tagName)

      core.info(`Created and pushed tag: ${tagName}`)
      return tagName
    } catch (error) {
      core.error(`Failed to create tag ${tagName}: ${error}`)
      throw error
    }
  }

  async createRelease(
    packageVersion: PackageVersion,
    changelog: string
  ): Promise<{ html_url: string } | null> {
    const tagName = this.formatTag(packageVersion.name, packageVersion.newVersion)
    const releaseName = this.formatReleaseName(packageVersion.name, packageVersion.newVersion)

    if (this.dryRun) {
      core.info(`[DRY RUN] Would create release: ${releaseName}`)
      return null
    }

    try {
      // Check if release already exists
      try {
        const { data: existingRelease } = await this.octokit.rest.repos.getReleaseByTag({
          owner: this.context.repo.owner,
          repo: this.context.repo.repo,
          tag: tagName
        })

        if (existingRelease) {
          core.warning(`Release for tag ${tagName} already exists`)
          return existingRelease
        }
      } catch {
        // Release doesn't exist, we can create it
      }

      // Create the release
      const { data: release } = await this.octokit.rest.repos.createRelease({
        owner: this.context.repo.owner,
        repo: this.context.repo.repo,
        tag_name: tagName,
        name: releaseName,
        body: changelog,
        draft: false,
        prerelease: this.isPrerelease(packageVersion.newVersion),
        generate_release_notes: false
      })

      core.info(`Created release: ${releaseName} (${release.html_url})`)
      return release
    } catch (error) {
      core.error(`Failed to create release for ${tagName}: ${error}`)
      throw error
    }
  }

  private formatTag(packageName: string, version: string): string {
    switch (this.tagFormat) {
      case 'npm':
        // NPM style: @scope/package@v1.0.0 or package@v1.0.0
        return `${packageName}@v${version}`

      case 'slash': {
        // Slash style: package/v1.0.0 or scope-package/v1.0.0
        const cleanName = packageName.replace('@', '').replace(/\//g, '-')
        return `${cleanName}/v${version}`
      }

      case 'standard':
        // Standard style: v1.0.0 (only works for single package repos or root releases)
        return `v${version}`

      default:
        return `v${version}`
    }
  }

  private formatReleaseName(packageName: string, version: string): string {
    // Clean package name for display
    const displayName = packageName.replace('@', '').replace(/\//g, ' ')

    // Capitalize first letter of each word
    const capitalizedName = displayName
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')

    return `${capitalizedName} v${version}`
  }

  private async tagExists(tagName: string): Promise<boolean> {
    try {
      // Check locally first
      const { exitCode } = await exec.getExecOutput('git', ['rev-parse', `refs/tags/${tagName}`], {
        ignoreReturnCode: true
      })

      if (exitCode === 0) {
        return true
      }

      // Also check remote
      try {
        await this.octokit.rest.git.getRef({
          owner: this.context.repo.owner,
          repo: this.context.repo.repo,
          ref: `tags/${tagName}`
        })
        return true
      } catch {
        return false
      }
    } catch {
      return false
    }
  }

  private async pushTagWithRetry(tagName: string, maxRetries: number = 3): Promise<void> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await exec.exec('git', ['push', 'origin', tagName])
        return // Success
      } catch (error) {
        lastError = error as Error
        core.warning(`Push attempt ${attempt}/${maxRetries} failed: ${error}`)

        if (attempt < maxRetries) {
          // Wait before retrying (exponential backoff)
          const delay = Math.pow(2, attempt) * 1000 // 2s, 4s, 8s
          core.info(`Retrying in ${delay}ms...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    throw new Error(`Failed to push tag ${tagName} after ${maxRetries} attempts: ${lastError?.message}`)
  }

  private isPrerelease(version: string): boolean {
    // Check if version contains prerelease identifiers
    return (
      version.includes('-alpha') ||
      version.includes('-beta') ||
      version.includes('-rc') ||
      version.includes('-preview') ||
      version.includes('-canary')
    )
  }
}
