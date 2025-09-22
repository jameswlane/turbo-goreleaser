import * as core from '@actions/core'
import * as github from '@actions/github'
import { SemanticReleaseParser } from './semantic-release'
import { TurboIntegration } from './turbo-integration'
import { TagManager } from './tag-manager'
import { ChangelogGenerator } from './changelog-generator'
import { GoReleaserConfig } from './goreleaser-config'
import type { ActionInputs, ReleaseResult } from './types'

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
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

    // Step 4: Create tags and releases
    core.startGroup('🏷️ Creating tags and releases')
    const releases: ReleaseResult[] = []

    for (const packageVersion of packageVersions) {
      const tag = await tagManager.createTag(packageVersion)
      const release = await tagManager.createRelease(
        packageVersion,
        changelogs.get(packageVersion.name) || ''
      )

      releases.push({
        package: packageVersion.name,
        version: packageVersion.newVersion,
        tag,
        releaseUrl: release?.html_url || ''
      })
    }
    core.endGroup()

    // Step 5: Run GoReleaser for applicable packages
    core.startGroup('🚀 Running GoReleaser')
    const goreleaserArtifacts = []

    for (const packageVersion of packageVersions) {
      if (await goreleaserConfig.isGoReleaserProject(packageVersion.path)) {
        const config = await goreleaserConfig.generateConfig(packageVersion)
        const artifacts = await goreleaserConfig.runGoReleaser(packageVersion, config)
        goreleaserArtifacts.push(...artifacts)
      }
    }
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
