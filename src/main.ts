import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import { ChangelogGenerator } from './changelog-generator'
import { MIN_NODE_VERSION, REQUIRED_NODE_VERSION_MESSAGE } from './constants'
import { GoReleaserConfig } from './goreleaser-config'
import { SemanticReleaseParser } from './semantic-release'
import { TagManager } from './tag-manager'
import { TurboIntegration } from './turbo-integration'
import type { ActionInputs, ReleaseResult } from './types'
import { validateWorkingDirectory } from './validation'

/**
 * Configures git user for GitHub Actions
 */
async function configureGitUser(): Promise<void> {
  try {
    // Check if git user is already configured
    const { stdout: userName } = await exec.getExecOutput('git', ['config', 'user.name'], {
      silent: true,
      ignoreReturnCode: true
    })

    const { stdout: userEmail } = await exec.getExecOutput('git', ['config', 'user.email'], {
      silent: true,
      ignoreReturnCode: true
    })

    // If not configured, set default GitHub Actions bot user
    if (!userName.trim()) {
      await exec.exec('git', ['config', 'user.name', 'github-actions[bot]'])
      core.debug('Configured git user.name as github-actions[bot]')
    }

    if (!userEmail.trim()) {
      await exec.exec('git', [
        'config',
        'user.email',
        'github-actions[bot]@users.noreply.github.com'
      ])
      core.debug('Configured git user.email as github-actions[bot]@users.noreply.github.com')
    }
  } catch (error) {
    core.warning(`Failed to configure git user: ${error}`)
  }
}

/**
 * Validates Node.js version
 */
function validateNodeVersion(): void {
  const nodeVersion = process.version
  const versionMatch = nodeVersion.match(/v?(\d+)\.(\d+)\.(\d+)/)

  if (!versionMatch) {
    throw new Error(`Invalid Node.js version format: ${nodeVersion}`)
  }

  const majorVersion = Number.parseInt(versionMatch[1], 10)

  if (majorVersion < MIN_NODE_VERSION) {
    throw new Error(`${REQUIRED_NODE_VERSION_MESSAGE}. Current version: ${nodeVersion}`)
  }
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
function validateInputs(inputs: ActionInputs): void {
  const validReleaseTypes = ['all', 'apps', 'packages']
  const validTagFormats = ['npm', 'slash', 'standard']

  // Set defaults for empty values
  const releaseType = inputs.releaseType || 'all'
  const tagFormat = inputs.tagFormat || 'slash'

  if (!validReleaseTypes.includes(releaseType)) {
    throw new Error(
      `Invalid release-type: ${releaseType}. Must be one of: ${validReleaseTypes.join(', ')}`
    )
  }

  if (!validTagFormats.includes(tagFormat)) {
    throw new Error(
      `Invalid tag-format: ${tagFormat}. Must be one of: ${validTagFormats.join(', ')}`
    )
  }

  // Validate and set working directory
  const workspacePath = process.env['GITHUB_WORKSPACE'] || process.cwd()
  if (inputs.workingDirectory) {
    inputs.workingDirectory = validateWorkingDirectory(inputs.workingDirectory)
  } else {
    inputs.workingDirectory = workspacePath
  }

  // Update inputs with defaults
  inputs.releaseType = releaseType as 'all' | 'apps' | 'packages'
  inputs.tagFormat = tagFormat as 'npm' | 'slash' | 'standard'
}
export async function run(): Promise<void> {
  try {
    // Validate Node version first
    validateNodeVersion()

    // Parse inputs
    const inputs: ActionInputs = {
      githubToken: core.getInput('github-token', { required: true }),
      goreleaserKey: core.getInput('goreleaser-key'),
      goreleaserVersion: core.getInput('goreleaser-version'),
      turboToken: core.getInput('turbo-token'),
      turboTeam: core.getInput('turbo-team'),
      releaseType: core.getInput('release-type') as 'all' | 'apps' | 'packages',
      tagFormat: core.getInput('tag-format') as 'npm' | 'slash' | 'standard',
      dryRun: core.getBooleanInput('dry-run'),
      conventionalCommits: core.getBooleanInput('conventional-commits'),
      workingDirectory: core.getInput('working-directory')
    }

    // Validate inputs
    validateInputs(inputs)

    core.info('🚀 Starting Turbo GoReleaser')
    core.info(`Release type: ${inputs.releaseType}`)
    core.info(`Tag format: ${inputs.tagFormat}`)
    core.info(`Dry run: ${inputs.dryRun}`)

    // Set up environment variables for Turbo
    if (inputs.turboToken) {
      core.exportVariable('TURBO_TOKEN', inputs.turboToken)
    }
    if (inputs.turboTeam) {
      core.exportVariable('TURBO_TEAM', inputs.turboTeam)
    }

    // Configure git user for GitHub Actions
    await configureGitUser()

    // Initialize components
    const octokit = github.getOctokit(inputs.githubToken)
    const context = github.context

    const semanticParser = new SemanticReleaseParser({
      enabled: inputs.conventionalCommits
    })

    const turboIntegration = new TurboIntegration({
      workingDirectory: inputs.workingDirectory
    })

    const tagManager = new TagManager({
      octokit,
      context,
      tagFormat: inputs.tagFormat,
      dryRun: inputs.dryRun
    })

    const changelogGenerator = new ChangelogGenerator({
      octokit,
      context
    })

    const goreleaserConfig = new GoReleaserConfig({
      goreleaserKey: inputs.goreleaserKey,
      goreleaserVersion: inputs.goreleaserVersion,
      dryRun: inputs.dryRun
    })

    // Step 1: Detect changed packages using Turbo
    core.startGroup('📦 Detecting changed packages')
    const changedPackages = await turboIntegration.getChangedPackages(inputs.releaseType)
    core.info(`Found ${changedPackages.length} changed packages:`)
    changedPackages.forEach(pkg => {
      core.info(`  - ${pkg.name} (${pkg.path})`)
    })
    core.endGroup()

    if (changedPackages.length === 0) {
      core.info('✅ No packages need to be released')
      return
    }

    // Step 2: Analyze commits and determine versions
    core.startGroup('🔍 Analyzing commits')
    const packageVersions = await semanticParser.analyzeCommits(changedPackages)
    core.info('Version bumps:')
    packageVersions.forEach(pv => {
      core.info(`  - ${pv.name}: ${pv.currentVersion} → ${pv.newVersion}`)
    })
    core.endGroup()

    // Step 3: Generate changelogs
    core.startGroup('📝 Generating changelogs')
    const changelogs = await changelogGenerator.generate(packageVersions)
    core.endGroup()

    // Step 4: Create tags and releases (parallel processing)
    core.startGroup('🏷️ Creating tags and releases')
    const tagAndReleasePromises = packageVersions.map(
      async (packageVersion): Promise<ReleaseResult> => {
        const tag = await tagManager.createTag(packageVersion)
        const release = await tagManager.createRelease(
          packageVersion,
          changelogs.get(packageVersion.name) || ''
        )

        return {
          package: packageVersion.name,
          version: packageVersion.newVersion,
          tag,
          releaseUrl: release?.html_url || ''
        }
      }
    )

    const releases = await Promise.all(tagAndReleasePromises)
    core.endGroup()

    // Step 5: Run GoReleaser for applicable packages (parallel processing)
    core.startGroup('🚀 Running GoReleaser')
    const goreleaserPromises = packageVersions.map(async packageVersion => {
      if (await goreleaserConfig.isGoReleaserProject(packageVersion.path)) {
        const config = await goreleaserConfig.generateConfig(packageVersion)
        const artifacts = await goreleaserConfig.runGoReleaser(packageVersion, config)
        return artifacts
      }
      return []
    })

    const goreleaserResults = await Promise.all(goreleaserPromises)
    const goreleaserArtifacts = goreleaserResults.flat()
    core.endGroup()

    // Set outputs
    core.setOutput('released-packages', JSON.stringify(releases))
    core.setOutput('release-notes', JSON.stringify(Object.fromEntries(changelogs)))
    core.setOutput('tags-created', releases.map(r => r.tag).join(','))
    core.setOutput('goreleaser-artifacts', JSON.stringify(goreleaserArtifacts))

    core.info('✅ Turbo GoReleaser completed successfully!')
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message)
    } else {
      core.setFailed('An unexpected error occurred')
    }
  }
}

// Execute the main function when the script is run directly
if (require.main === module) {
  run()
}
