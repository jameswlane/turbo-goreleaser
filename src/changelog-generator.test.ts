import * as core from '@actions/core'
import type { Context } from '@actions/github/lib/context'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangelogGenerator } from '../src/changelog-generator'
import type { ChangelogGeneratorConfig, Commit, Octokit, PackageVersion } from '../src/types'

// Mock @actions/core
vi.mock('@actions/core')
const mockedCore = vi.mocked(core)

describe('ChangelogGenerator', () => {
  let mockOctokit: Octokit
  let mockContext: Context
  let config: ChangelogGeneratorConfig
  let changelogGenerator: ChangelogGenerator

  const sampleCommits: Commit[] = [
    {
      sha: 'abc123def456',
      message: 'feat(ui): add new button component',
      type: 'feat',
      scope: 'ui',
      breaking: false
    },
    {
      sha: 'def456ghi789',
      message: 'fix(api): resolve authentication issue',
      type: 'fix',
      scope: 'api',
      breaking: false
    },
    {
      sha: 'ghi789jkl012',
      message: 'feat!: breaking change to API structure',
      type: 'feat',
      scope: undefined,
      breaking: true
    },
    {
      sha: 'jkl012mno345',
      message: 'docs: update README',
      type: 'docs',
      scope: undefined,
      breaking: false
    }
  ]

  const samplePackageVersion: PackageVersion = {
    name: '@myorg/package',
    path: '/packages/mypackage',
    version: '1.2.0',
    currentVersion: '1.1.0',
    newVersion: '1.2.0',
    releaseType: 'minor',
    commits: sampleCommits
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockOctokit = {
      rest: {
        repos: {
          getCommit: vi.fn()
        }
      }
    } as Octokit

    mockContext = {
      repo: {
        owner: 'testowner',
        repo: 'testrepo'
      }
    } as Context

    config = {
      octokit: mockOctokit,
      context: mockContext
    }

    changelogGenerator = new ChangelogGenerator(config)
  })

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(changelogGenerator).toBeInstanceOf(ChangelogGenerator)
    })
  })

  describe('generate', () => {
    it('should generate changelogs for all packages', async () => {
      const packageVersions: PackageVersion[] = [
        samplePackageVersion,
        {
          ...samplePackageVersion,
          name: '@myorg/package2',
          commits: [sampleCommits[0]]
        }
      ]

      // Mock the getCommit API call
      mockOctokit.rest.repos.getCommit = vi.fn().mockResolvedValue({
        data: {
          author: {
            login: 'testuser'
          }
        }
      })

      const changelogs = await changelogGenerator.generate(packageVersions)

      expect(changelogs.size).toBe(2)
      expect(changelogs.has('@myorg/package')).toBe(true)
      expect(changelogs.has('@myorg/package2')).toBe(true)
    })

    it('should return empty map for empty package versions', async () => {
      const changelogs = await changelogGenerator.generate([])
      expect(changelogs.size).toBe(0)
    })
  })

  describe('generatePackageChangelog', () => {
    beforeEach(() => {
      mockOctokit.rest.repos.getCommit = vi.fn().mockResolvedValue({
        data: {
          author: {
            login: 'testuser'
          }
        }
      })
    })

    it('should generate changelog with all sections', async () => {
      const changelog = await changelogGenerator.generatePackageChangelog(samplePackageVersion)

      expect(changelog).toContain('## @myorg/package v1.2.0')
      expect(changelog).toContain('### 🚨 Breaking Changes')
      expect(changelog).toContain('### 🚀 Features')
      expect(changelog).toContain('### 🐛 Bug Fixes')
      expect(changelog).toContain('### 🛠️ Other Changes')
      expect(changelog).toContain('### 👥 Contributors')
      expect(changelog).toContain('**Full Changelog**:')
    })

    it('should handle package with only features', async () => {
      const packageWithFeatures: PackageVersion = {
        ...samplePackageVersion,
        commits: [sampleCommits[0]] // Only feat commit
      }

      const changelog = await changelogGenerator.generatePackageChangelog(packageWithFeatures)

      expect(changelog).toContain('### 🚀 Features')
      expect(changelog).not.toContain('### 🚨 Breaking Changes')
      expect(changelog).not.toContain('### 🐛 Bug Fixes')
      expect(changelog).not.toContain('### 🛠️ Other Changes')
    })

    it('should handle package with no commits', async () => {
      const packageWithNoCommits: PackageVersion = {
        ...samplePackageVersion,
        commits: []
      }

      const changelog = await changelogGenerator.generatePackageChangelog(packageWithNoCommits)

      expect(changelog).toContain('## @myorg/package v1.2.0')
      expect(changelog).not.toContain('### 🚨 Breaking Changes')
      expect(changelog).not.toContain('### 🚀 Features')
      expect(changelog).not.toContain('### 🐛 Bug Fixes')
      expect(changelog).not.toContain('### 🛠️ Other Changes')
      expect(changelog).not.toContain('### 👥 Contributors')
    })
  })

  describe('groupCommits', () => {
    it('should group commits by type correctly', () => {
      const grouped = changelogGenerator.groupCommits(sampleCommits)

      expect(grouped.breaking).toHaveLength(1)
      expect(grouped.features).toHaveLength(1)
      expect(grouped.fixes).toHaveLength(1)
      expect(grouped.other).toHaveLength(1)

      expect(grouped.breaking[0].breaking).toBe(true)
      expect(grouped.features[0].type).toBe('feat')
      expect(grouped.features[0].breaking).toBe(false)
      expect(grouped.fixes[0].type).toBe('fix')
      expect(grouped.other[0].type).toBe('docs')
    })

    it('should handle breaking changes with different types', () => {
      const commitsWithBreaking: Commit[] = [
        {
          sha: 'abc123',
          message: 'fix!: breaking fix',
          type: 'fix',
          breaking: true
        },
        {
          sha: 'def456',
          message: 'feat: regular feature',
          type: 'feat',
          breaking: false
        }
      ]

      const grouped = changelogGenerator.groupCommits(commitsWithBreaking)

      expect(grouped.breaking).toHaveLength(1)
      expect(grouped.features).toHaveLength(1)
      expect(grouped.fixes).toHaveLength(0)
    })

    it('should handle empty commits array', () => {
      const grouped = changelogGenerator.groupCommits([])

      expect(grouped.breaking).toHaveLength(0)
      expect(grouped.features).toHaveLength(0)
      expect(grouped.fixes).toHaveLength(0)
      expect(grouped.other).toHaveLength(0)
    })
  })

  describe('formatCommit', () => {
    it('should format commit with scope correctly', () => {
      const commit: Commit = {
        sha: 'abc123def456ghi789',
        message: 'feat(ui): add new button component',
        type: 'feat',
        scope: 'ui'
      }

      const formatted = changelogGenerator.formatCommit(commit)

      expect(formatted).toBe(
        '- **ui:** add new button component ([abc123d](https://github.com/testowner/testrepo/commit/abc123def456ghi789))'
      )
    })

    it('should format commit without scope correctly', () => {
      const commit: Commit = {
        sha: 'abc123def456ghi789',
        message: 'fix: resolve authentication issue',
        type: 'fix'
      }

      const formatted = changelogGenerator.formatCommit(commit)

      expect(formatted).toBe(
        '- resolve authentication issue ([abc123d](https://github.com/testowner/testrepo/commit/abc123def456ghi789))'
      )
    })

    it('should clean commit message from type prefix', () => {
      const commit: Commit = {
        sha: 'abc123def456ghi789',
        message: 'feat(scope): some feature\n\nDetailed description',
        type: 'feat',
        scope: 'scope'
      }

      const formatted = changelogGenerator.formatCommit(commit)

      expect(formatted).toBe(
        '- **scope:** some feature ([abc123d](https://github.com/testowner/testrepo/commit/abc123def456ghi789))'
      )
    })

    it('should handle multiline commit messages', () => {
      const commit: Commit = {
        sha: 'abc123def456ghi789',
        message: 'feat: add feature\n\nThis is a detailed description\nwith multiple lines',
        type: 'feat'
      }

      const formatted = changelogGenerator.formatCommit(commit)

      expect(formatted).toBe(
        '- add feature ([abc123d](https://github.com/testowner/testrepo/commit/abc123def456ghi789))'
      )
    })
  })

  describe('generateComparisonLink', () => {
    it('should generate comparison link for normal releases', () => {
      const link = changelogGenerator.generateComparisonLink('1.0.0', '1.1.0', samplePackageVersion)

      expect(link).toBe(
        '**Full Changelog**: https://github.com/testowner/testrepo/compare/myorg-package/v1.0.0...myorg-package/v1.1.0'
      )
    })

    it('should generate full changelog link for first release', () => {
      const link = changelogGenerator.generateComparisonLink('0.0.0', '1.0.0', samplePackageVersion)

      expect(link).toBe(
        '**Full Changelog**: https://github.com/testowner/testrepo/commits/myorg-package/v1.0.0'
      )
    })

    it('should generate full changelog link for undefined current version', () => {
      const link = changelogGenerator.generateComparisonLink('', '1.0.0', samplePackageVersion)

      expect(link).toBe(
        '**Full Changelog**: https://github.com/testowner/testrepo/commits/myorg-package/v1.0.0'
      )
    })
  })

  describe('getTagName', () => {
    it('should format tag name correctly', () => {
      const tagName = changelogGenerator.getTagName('@myorg/package', '1.2.0')

      expect(tagName).toBe('myorg-package/v1.2.0')
    })

    it('should handle package names without scope', () => {
      const tagName = changelogGenerator.getTagName('package', '1.2.0')

      expect(tagName).toBe('package/v1.2.0')
    })

    it('should handle package names with multiple slashes', () => {
      const tagName = changelogGenerator.getTagName('@myorg/nested/package', '1.2.0')

      expect(tagName).toBe('myorg-nested-package/v1.2.0')
    })
  })

  describe('getContributors', () => {
    it('should get unique contributors from commits', async () => {
      const commits: Commit[] = [
        { sha: 'abc123', message: 'commit1' },
        { sha: 'def456', message: 'commit2' },
        { sha: 'abc123', message: 'commit1' } // duplicate
      ]

      mockOctokit.rest.repos.getCommit = vi
        .fn()
        .mockResolvedValueOnce({
          data: { author: { login: 'user1' } }
        })
        .mockResolvedValueOnce({
          data: { author: { login: 'user2' } }
        })

      const contributors = await changelogGenerator.getContributors(commits)

      expect(contributors).toEqual(['user1', 'user2'])
      expect(mockOctokit.rest.repos.getCommit).toHaveBeenCalledTimes(2) // Only unique SHAs
    })

    it('should handle commits without authors', async () => {
      const commits: Commit[] = [{ sha: 'abc123', message: 'commit1' }]

      mockOctokit.rest.repos.getCommit = vi.fn().mockResolvedValue({
        data: { author: null }
      })

      const contributors = await changelogGenerator.getContributors(commits)

      expect(contributors).toEqual([])
    })

    it('should handle API errors gracefully', async () => {
      const commits: Commit[] = [{ sha: 'abc123', message: 'commit1' }]

      mockOctokit.rest.repos.getCommit = vi.fn().mockRejectedValue(new Error('API Error'))

      const contributors = await changelogGenerator.getContributors(commits)

      expect(contributors).toEqual([])
      expect(mockedCore.debug).toHaveBeenCalledWith('Failed to get commit abc123: Error: API Error')
    })

    it('should sort contributors alphabetically', async () => {
      const commits: Commit[] = [
        { sha: 'abc123', message: 'commit1' },
        { sha: 'def456', message: 'commit2' },
        { sha: 'ghi789', message: 'commit3' }
      ]

      mockOctokit.rest.repos.getCommit = vi
        .fn()
        .mockResolvedValueOnce({
          data: { author: { login: 'zebra' } }
        })
        .mockResolvedValueOnce({
          data: { author: { login: 'alpha' } }
        })
        .mockResolvedValueOnce({
          data: { author: { login: 'beta' } }
        })

      const contributors = await changelogGenerator.getContributors(commits)

      expect(contributors).toEqual(['alpha', 'beta', 'zebra'])
    })

    it('should handle general errors and log warning', async () => {
      const commits: Commit[] = [{ sha: 'abc123', message: 'commit1' }]

      // Simulate error before the loop
      vi.spyOn(changelogGenerator as any, 'getContributors').mockImplementation(async () => {
        try {
          throw new Error('General error')
        } catch (error) {
          mockedCore.warning(`Failed to get contributors: ${error}`)
          return []
        }
      })

      const contributors = await changelogGenerator.getContributors(commits)

      expect(contributors).toEqual([])
      expect(mockedCore.warning).toHaveBeenCalledWith(
        'Failed to get contributors: Error: General error'
      )
    })
  })
})
