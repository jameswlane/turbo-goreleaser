import * as core from '@actions/core'
import * as github from '@actions/github'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangelogGenerator } from './changelog-generator'
import { GoReleaserConfig } from './goreleaser-config'
import { run } from './main'
import { SemanticReleaseParser } from './semantic-release'
import { TagManager } from './tag-manager'
import { TurboIntegration } from './turbo-integration'
import type { GoReleaserArtifact, Package, PackageVersion, ReleaseResult } from './types'

// Mock all dependencies
vi.mock('@actions/core')
vi.mock('@actions/github')
vi.mock('../src/semantic-release')
vi.mock('../src/turbo-integration')
vi.mock('../src/tag-manager')
vi.mock('../src/changelog-generator')
vi.mock('../src/goreleaser-config')

const mockedCore = vi.mocked(core)
const mockedGithub = vi.mocked(github)
const mockedSemanticReleaseParser = vi.mocked(SemanticReleaseParser)
const mockedTurboIntegration = vi.mocked(TurboIntegration)
const mockedTagManager = vi.mocked(TagManager)
const mockedChangelogGenerator = vi.mocked(ChangelogGenerator)
const mockedGoReleaserConfig = vi.mocked(GoReleaserConfig)

describe('main', () => {
  let mockOctokit: any
  let mockContext: any
  let mockSemanticParser: any
  let mockTurboIntegration: any
  let mockTagManager: any
  let mockChangelogGenerator: any
  let mockGoreleaserConfig: any

  const samplePackages: Package[] = [
    {
      name: '@myorg/package-a',
      path: 'packages/package-a',
      version: '1.0.0'
    },
    {
      name: '@myorg/package-b',
      path: 'packages/package-b',
      version: '2.0.0'
    }
  ]

  const samplePackageVersions: PackageVersion[] = [
    {
      ...samplePackages[0],
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseType: 'minor',
      commits: [
        {
          sha: 'abc123',
          message: 'feat: new feature',
          type: 'feat'
        }
      ]
    },
    {
      ...samplePackages[1],
      currentVersion: '2.0.0',
      newVersion: '2.0.1',
      releaseType: 'patch',
      commits: [
        {
          sha: 'def456',
          message: 'fix: bug fix',
          type: 'fix'
        }
      ]
    }
  ]

  const sampleChangelogs = new Map([
    ['@myorg/package-a', '## @myorg/package-a v1.1.0\n\n### 🚀 Features\n- new feature'],
    ['@myorg/package-b', '## @myorg/package-b v2.0.1\n\n### 🐛 Bug Fixes\n- bug fix']
  ])

  const sampleReleases: any[] = [
    {
      html_url: 'https://github.com/owner/repo/releases/tag/myorg-package-a-v1.1.0'
    },
    {
      html_url: 'https://github.com/owner/repo/releases/tag/myorg-package-b-v2.0.1'
    }
  ]

  const sampleArtifacts: GoReleaserArtifact[] = [
    {
      name: 'package-a-linux-amd64.tar.gz',
      path: '/dist/package-a-linux-amd64.tar.gz',
      type: 'archive'
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock core inputs
    mockedCore.getInput.mockImplementation((name: string, options?: { required?: boolean }) => {
      const inputs: Record<string, string> = {
        'github-token': 'gh_token',
        'goreleaser-key': 'goreleaser_key',
        'goreleaser-version': '~> v2',
        'turbo-token': 'turbo_token',
        'turbo-team': 'turbo_team',
        'release-type': 'packages',
        'tag-format': 'slash',
        'working-directory': '/workspace'
      }
      return inputs[name] || ''
    })

    mockedCore.getBooleanInput.mockImplementation((name: string) => {
      const booleanInputs: Record<string, boolean> = {
        'dry-run': false,
        'conventional-commits': true
      }
      return booleanInputs[name] || false
    })

    // Mock GitHub
    mockOctokit = {
      rest: {
        repos: {
          createRelease: vi.fn()
        }
      }
    }
    mockContext = {
      repo: {
        owner: 'testowner',
        repo: 'testrepo'
      }
    }
    mockedGithub.getOctokit.mockReturnValue(mockOctokit)
    mockedGithub.context = mockContext

    // Mock class instances
    mockSemanticParser = {
      analyzeCommits: vi.fn().mockResolvedValue(samplePackageVersions)
    }
    mockedSemanticReleaseParser.mockImplementation(() => mockSemanticParser)

    mockTurboIntegration = {
      getChangedPackages: vi.fn().mockResolvedValue(samplePackages)
    }
    mockedTurboIntegration.mockImplementation(() => mockTurboIntegration)

    mockTagManager = {
      createTag: vi
        .fn()
        .mockImplementation((pv: PackageVersion) =>
          Promise.resolve(`${pv.name.replace('@', '').replace('/', '-')}/v${pv.newVersion}`)
        ),
      createRelease: vi
        .fn()
        .mockImplementation((pv: PackageVersion, changelog: string) =>
          Promise.resolve(sampleReleases[samplePackageVersions.indexOf(pv)])
        )
    }
    mockedTagManager.mockImplementation(() => mockTagManager)

    mockChangelogGenerator = {
      generate: vi.fn().mockResolvedValue(sampleChangelogs)
    }
    mockedChangelogGenerator.mockImplementation(() => mockChangelogGenerator)

    mockGoreleaserConfig = {
      isGoReleaserProject: vi.fn().mockResolvedValue(true),
      generateConfig: vi.fn().mockResolvedValue('/path/to/.goreleaser.yml'),
      runGoReleaser: vi.fn().mockResolvedValue(sampleArtifacts)
    }
    mockedGoReleaserConfig.mockImplementation(() => mockGoreleaserConfig)

    // Mock core functions
    mockedCore.info.mockImplementation(() => {})
    mockedCore.startGroup.mockImplementation(() => {})
    mockedCore.endGroup.mockImplementation(() => {})
    mockedCore.exportVariable.mockImplementation(() => {})
    mockedCore.setOutput.mockImplementation(() => {})
    mockedCore.setFailed.mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('successful execution', () => {
    it('should complete full release process successfully', async () => {
      await run()

      // Verify initialization
      expect(mockedCore.info).toHaveBeenCalledWith('🚀 Starting Turbo GoReleaser')
      expect(mockedCore.info).toHaveBeenCalledWith('Release type: packages')
      expect(mockedCore.info).toHaveBeenCalledWith('Tag format: slash')
      expect(mockedCore.info).toHaveBeenCalledWith('Dry run: false')

      // Verify environment variables are set
      expect(mockedCore.exportVariable).toHaveBeenCalledWith('TURBO_TOKEN', 'turbo_token')
      expect(mockedCore.exportVariable).toHaveBeenCalledWith('TURBO_TEAM', 'turbo_team')

      // Verify component initialization
      expect(mockedSemanticReleaseParser).toHaveBeenCalledWith({ enabled: true })
      expect(mockedTurboIntegration).toHaveBeenCalledWith({ workingDirectory: '/workspace' })
      expect(mockedTagManager).toHaveBeenCalledWith({
        octokit: mockOctokit,
        context: mockContext,
        tagFormat: 'slash',
        dryRun: false
      })
      expect(mockedChangelogGenerator).toHaveBeenCalledWith({
        octokit: mockOctokit,
        context: mockContext
      })
      expect(mockedGoReleaserConfig).toHaveBeenCalledWith({
        goreleaserKey: 'goreleaser_key',
        goreleaserVersion: '~> v2',
        dryRun: false
      })

      // Verify workflow steps
      expect(mockTurboIntegration.getChangedPackages).toHaveBeenCalledWith('packages')
      expect(mockSemanticParser.analyzeCommits).toHaveBeenCalledWith(samplePackages)
      expect(mockChangelogGenerator.generate).toHaveBeenCalledWith(samplePackageVersions)

      // Verify tags and releases created
      expect(mockTagManager.createTag).toHaveBeenCalledTimes(2)
      expect(mockTagManager.createRelease).toHaveBeenCalledTimes(2)

      // Verify GoReleaser execution
      expect(mockGoreleaserConfig.isGoReleaserProject).toHaveBeenCalledTimes(2)
      expect(mockGoreleaserConfig.generateConfig).toHaveBeenCalledTimes(2)
      expect(mockGoreleaserConfig.runGoReleaser).toHaveBeenCalledTimes(2)

      // Verify outputs are set
      expect(mockedCore.setOutput).toHaveBeenCalledWith('released-packages', expect.any(String))
      expect(mockedCore.setOutput).toHaveBeenCalledWith('release-notes', expect.any(String))
      expect(mockedCore.setOutput).toHaveBeenCalledWith('tags-created', expect.any(String))
      expect(mockedCore.setOutput).toHaveBeenCalledWith('goreleaser-artifacts', expect.any(String))

      expect(mockedCore.info).toHaveBeenCalledWith('✅ Turbo GoReleaser completed successfully!')
    })

    it('should handle packages without GoReleaser projects', async () => {
      mockGoreleaserConfig.isGoReleaserProject.mockResolvedValue(false)

      await run()

      expect(mockGoreleaserConfig.isGoReleaserProject).toHaveBeenCalledTimes(2)
      expect(mockGoreleaserConfig.generateConfig).not.toHaveBeenCalled()
      expect(mockGoreleaserConfig.runGoReleaser).not.toHaveBeenCalled()
      expect(mockedCore.setOutput).toHaveBeenCalledWith('goreleaser-artifacts', '[]')
    })

    it('should handle mixed GoReleaser projects', async () => {
      mockGoreleaserConfig.isGoReleaserProject
        .mockResolvedValueOnce(true) // First package is GoReleaser project
        .mockResolvedValueOnce(false) // Second package is not

      await run()

      expect(mockGoreleaserConfig.generateConfig).toHaveBeenCalledTimes(1)
      expect(mockGoreleaserConfig.runGoReleaser).toHaveBeenCalledTimes(1)
      expect(mockGoreleaserConfig.generateConfig).toHaveBeenCalledWith(samplePackageVersions[0])
    })
  })

  describe('early exit scenarios', () => {
    it('should exit early when no packages changed', async () => {
      mockTurboIntegration.getChangedPackages.mockResolvedValue([])

      await run()

      expect(mockedCore.info).toHaveBeenCalledWith('Found 0 changed packages:')
      expect(mockedCore.info).toHaveBeenCalledWith('✅ No packages need to be released')

      // Verify later steps are not executed
      expect(mockSemanticParser.analyzeCommits).not.toHaveBeenCalled()
      expect(mockChangelogGenerator.generate).not.toHaveBeenCalled()
      expect(mockTagManager.createTag).not.toHaveBeenCalled()
    })

    it('should handle empty package versions from semantic analysis', async () => {
      mockSemanticParser.analyzeCommits.mockResolvedValue([])

      await run()

      expect(mockSemanticParser.analyzeCommits).toHaveBeenCalledWith(samplePackages)
      expect(mockChangelogGenerator.generate).toHaveBeenCalledWith([])
      expect(mockTagManager.createTag).not.toHaveBeenCalled()
      expect(mockedCore.setOutput).toHaveBeenCalledWith('released-packages', '[]')
    })
  })

  describe('input validation and environment setup', () => {
    it('should handle missing optional inputs', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        const requiredInputs: Record<string, string> = {
          'github-token': 'gh_token'
        }
        return requiredInputs[name] || ''
      })

      await run()

      // Should not call exportVariable for missing tokens
      expect(mockedCore.exportVariable).not.toHaveBeenCalledWith('TURBO_TOKEN', '')
      expect(mockedCore.exportVariable).not.toHaveBeenCalledWith('TURBO_TEAM', '')

      // Components should be initialized with empty/default values
      expect(mockedGoReleaserConfig).toHaveBeenCalledWith({
        goreleaserKey: '',
        goreleaserVersion: '',
        dryRun: false
      })
    })

    it('should handle different release types', async () => {
      mockedCore.getInput.mockImplementation((name: string) => {
        if (name === 'release-type') return 'apps'
        return name === 'github-token' ? 'gh_token' : ''
      })

      await run()

      expect(mockTurboIntegration.getChangedPackages).toHaveBeenCalledWith('apps')
      expect(mockedCore.info).toHaveBeenCalledWith('Release type: apps')
    })

    it('should handle dry run mode', async () => {
      mockedCore.getBooleanInput.mockImplementation((name: string) => {
        return name === 'dry-run'
      })

      await run()

      expect(mockedTagManager).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }))
      expect(mockedGoReleaserConfig).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }))
      expect(mockedCore.info).toHaveBeenCalledWith('Dry run: true')
    })

    it('should handle conventional commits disabled', async () => {
      mockedCore.getBooleanInput.mockImplementation((name: string) => {
        return name === 'dry-run' // Only dry-run is true, conventional-commits is false
      })

      await run()

      expect(mockedSemanticReleaseParser).toHaveBeenCalledWith({ enabled: false })
    })
  })

  describe('output generation', () => {
    it('should generate correct outputs', async () => {
      await run()

      const releasedPackagesCall = mockedCore.setOutput.mock.calls.find(
        call => call[0] === 'released-packages'
      )
      const releaseNotesCall = mockedCore.setOutput.mock.calls.find(
        call => call[0] === 'release-notes'
      )
      const tagsCreatedCall = mockedCore.setOutput.mock.calls.find(
        call => call[0] === 'tags-created'
      )
      const goreleaserArtifactsCall = mockedCore.setOutput.mock.calls.find(
        call => call[0] === 'goreleaser-artifacts'
      )

      expect(releasedPackagesCall).toBeDefined()
      expect(releaseNotesCall).toBeDefined()
      expect(tagsCreatedCall).toBeDefined()
      expect(goreleaserArtifactsCall).toBeDefined()

      // Verify tags created output format
      const tagsCreated = tagsCreatedCall![1]
      expect(tagsCreated).toContain('myorg-package-a/v1.1.0')
      expect(tagsCreated).toContain('myorg-package-b/v2.0.1')

      // Verify released packages is valid JSON
      const releasedPackagesJson = releasedPackagesCall![1]
      expect(() => JSON.parse(releasedPackagesJson)).not.toThrow()

      // Verify release notes is valid JSON
      const releaseNotesJson = releaseNotesCall![1]
      expect(() => JSON.parse(releaseNotesJson)).not.toThrow()

      // Verify goreleaser artifacts is valid JSON
      const goreleaserArtifactsJson = goreleaserArtifactsCall![1]
      expect(() => JSON.parse(goreleaserArtifactsJson)).not.toThrow()
    })

    it('should handle releases without URLs', async () => {
      mockTagManager.createRelease.mockResolvedValue(null)

      await run()

      const releasedPackagesCall = mockedCore.setOutput.mock.calls.find(
        call => call[0] === 'released-packages'
      )

      const releasedPackages = JSON.parse(releasedPackagesCall![1]) as ReleaseResult[]
      expect(releasedPackages).toHaveLength(2)
      expect(releasedPackages[0].releaseUrl).toBe('')
      expect(releasedPackages[1].releaseUrl).toBe('')
    })
  })

  describe('error handling', () => {
    it('should handle Error instances', async () => {
      const error = new Error('Test error message')
      mockTurboIntegration.getChangedPackages.mockRejectedValue(error)

      await run()

      expect(mockedCore.setFailed).toHaveBeenCalledWith('Test error message')
    })

    it('should handle non-Error exceptions', async () => {
      mockTurboIntegration.getChangedPackages.mockRejectedValue('String error')

      await run()

      expect(mockedCore.setFailed).toHaveBeenCalledWith('An unexpected error occurred')
    })

    it('should handle errors in semantic analysis', async () => {
      mockSemanticParser.analyzeCommits.mockRejectedValue(new Error('Semantic analysis failed'))

      await run()

      expect(mockedCore.setFailed).toHaveBeenCalledWith('Semantic analysis failed')
    })

    it('should handle errors in changelog generation', async () => {
      mockChangelogGenerator.generate.mockRejectedValue(new Error('Changelog generation failed'))

      await run()

      expect(mockedCore.setFailed).toHaveBeenCalledWith('Changelog generation failed')
    })

    it('should handle errors in tag creation', async () => {
      mockTagManager.createTag.mockRejectedValue(new Error('Tag creation failed'))

      await run()

      expect(mockedCore.setFailed).toHaveBeenCalledWith('Tag creation failed')
    })

    it('should handle errors in GoReleaser execution', async () => {
      mockGoreleaserConfig.runGoReleaser.mockRejectedValue(new Error('GoReleaser failed'))

      await run()

      expect(mockedCore.setFailed).toHaveBeenCalledWith('GoReleaser failed')
    })
  })

  describe('logging and groups', () => {
    it('should use proper logging groups', async () => {
      await run()

      expect(mockedCore.startGroup).toHaveBeenCalledWith('📦 Detecting changed packages')
      expect(mockedCore.startGroup).toHaveBeenCalledWith('🔍 Analyzing commits')
      expect(mockedCore.startGroup).toHaveBeenCalledWith('📝 Generating changelogs')
      expect(mockedCore.startGroup).toHaveBeenCalledWith('🏷️ Creating tags and releases')
      expect(mockedCore.startGroup).toHaveBeenCalledWith('🚀 Running GoReleaser')

      expect(mockedCore.endGroup).toHaveBeenCalledTimes(5)
    })

    it('should log package information', async () => {
      await run()

      expect(mockedCore.info).toHaveBeenCalledWith('Found 2 changed packages:')
      expect(mockedCore.info).toHaveBeenCalledWith('  - @myorg/package-a (packages/package-a)')
      expect(mockedCore.info).toHaveBeenCalledWith('  - @myorg/package-b (packages/package-b)')

      expect(mockedCore.info).toHaveBeenCalledWith('Version bumps:')
      expect(mockedCore.info).toHaveBeenCalledWith('  - @myorg/package-a: 1.0.0 → 1.1.0')
      expect(mockedCore.info).toHaveBeenCalledWith('  - @myorg/package-b: 2.0.0 → 2.0.1')
    })
  })

  describe('input validation', () => {
    it('should validate release-type input', async () => {
      mockedCore.getInput.mockImplementation(name => {
        switch (name) {
          case 'github-token':
            return 'gh_token'
          case 'release-type':
            return 'invalid-type'
          default:
            return ''
        }
      })

      await run()

      expect(mockedCore.setFailed).toHaveBeenCalledWith(
        'Invalid release-type: invalid-type. Must be one of: all, apps, packages'
      )
    })

    it('should validate tag-format input', async () => {
      mockedCore.getInput.mockImplementation(name => {
        switch (name) {
          case 'github-token':
            return 'gh_token'
          case 'release-type':
            return 'all' // Valid release type
          case 'tag-format':
            return 'invalid-format'
          default:
            return ''
        }
      })

      await run()

      expect(mockedCore.setFailed).toHaveBeenCalledWith(
        'Invalid tag-format: invalid-format. Must be one of: npm, slash, standard'
      )
    })

    it('should validate working-directory input for unsafe characters', async () => {
      mockedCore.getInput.mockImplementation(name => {
        switch (name) {
          case 'github-token':
            return 'gh_token'
          case 'release-type':
            return 'all' // Valid release type
          case 'tag-format':
            return 'slash' // Valid tag format
          case 'working-directory':
            return '../../../etc/passwd'
          default:
            return ''
        }
      })

      await run()

      expect(mockedCore.setFailed).toHaveBeenCalledWith(
        'Invalid working-directory: contains unsafe characters'
      )
    })

    it('should accept valid inputs', async () => {
      mockedCore.getInput.mockImplementation(name => {
        switch (name) {
          case 'github-token':
            return 'gh_token'
          case 'release-type':
            return 'packages'
          case 'tag-format':
            return 'slash'
          case 'working-directory':
            return './my-project'
          default:
            return ''
        }
      })

      await run()

      expect(mockedCore.setFailed).not.toHaveBeenCalled()
    })
  })
})
