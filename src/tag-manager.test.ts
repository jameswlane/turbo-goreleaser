import * as core from '@actions/core'
import * as exec from '@actions/exec'
import type { Context } from '@actions/github/lib/context'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TagManager, type TagManagerConfig } from '../src/tag-manager'
import type { Octokit, PackageVersion } from '../src/types'

// Mock all external dependencies
vi.mock('@actions/core')
vi.mock('@actions/exec')

const mockedCore = vi.mocked(core)
const mockedExec = vi.mocked(exec)

describe('TagManager', () => {
  let tagManager: TagManager
  let mockOctokit: Octokit
  let mockContext: Context
  let defaultConfig: TagManagerConfig

  const samplePackageVersion: PackageVersion = {
    name: '@myorg/package',
    path: 'packages/mypackage',
    version: '1.0.0',
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
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockOctokit = {
      rest: {
        repos: {
          getReleaseByTag: vi.fn(),
          createRelease: vi.fn()
        },
        git: {
          getRef: vi.fn()
        }
      }
    } as any

    mockContext = {
      repo: {
        owner: 'testowner',
        repo: 'testrepo'
      }
    } as Context

    defaultConfig = {
      octokit: mockOctokit,
      context: mockContext,
      tagFormat: 'slash',
      dryRun: false
    }

    tagManager = new TagManager(defaultConfig)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should initialize with provided config', () => {
      expect(tagManager).toBeInstanceOf(TagManager)
    })

    it('should handle different tag formats', () => {
      const configs = [
        { ...defaultConfig, tagFormat: 'npm' as const },
        { ...defaultConfig, tagFormat: 'slash' as const },
        { ...defaultConfig, tagFormat: 'standard' as const }
      ]

      configs.forEach(config => {
        const manager = new TagManager(config)
        expect(manager).toBeInstanceOf(TagManager)
      })
    })
  })

  describe('createTag', () => {
    beforeEach(() => {
      mockedExec.getExecOutput.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1 // Tag doesn't exist
      })
      mockedExec.exec.mockResolvedValue(0)
      mockOctokit.rest.git.getRef = vi.fn().mockRejectedValue(new Error('Not found'))
    })

    it('should create and push tag successfully', async () => {
      const result = await tagManager.createTag(samplePackageVersion)

      expect(result).toBe('myorg-package/v1.1.0')
      expect(mockedExec.exec).toHaveBeenCalledWith(
        'git',
        ['tag', '-a', 'myorg-package/v1.1.0', '-m', 'Release @myorg/package v1.1.0'],
        expect.objectContaining({ cwd: expect.any(String) })
      )
      expect(mockedExec.exec).toHaveBeenCalledWith(
        'git',
        ['push', 'origin', 'myorg-package/v1.1.0'],
        expect.objectContaining({ cwd: expect.any(String) })
      )
      expect(mockedCore.info).toHaveBeenCalledWith('Created and pushed tag: myorg-package/v1.1.0')
    })

    it('should return tag name in dry run mode without creating tag', async () => {
      const dryRunManager = new TagManager({ ...defaultConfig, dryRun: true })

      const result = await dryRunManager.createTag(samplePackageVersion)

      expect(result).toBe('myorg-package/v1.1.0')
      expect(mockedCore.info).toHaveBeenCalledWith(
        '[DRY RUN] Would create tag: myorg-package/v1.1.0'
      )
      expect(mockedExec.exec).not.toHaveBeenCalled()
    })

    it('should skip creating tag if it already exists locally', async () => {
      mockedExec.getExecOutput.mockResolvedValue({
        stdout: 'abc123def456',
        stderr: '',
        exitCode: 0 // Tag exists locally
      })

      const result = await tagManager.createTag(samplePackageVersion)

      expect(result).toBe('myorg-package/v1.1.0')
      expect(mockedCore.warning).toHaveBeenCalledWith(
        'Tag myorg-package/v1.1.0 already exists, skipping'
      )
      expect(mockedExec.exec).not.toHaveBeenCalled()
    })

    it('should skip creating tag if it exists remotely', async () => {
      mockedExec.getExecOutput.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1 // Tag doesn't exist locally
      })
      mockOctokit.rest.git.getRef = vi.fn().mockResolvedValue({
        data: { ref: 'refs/tags/myorg-package/v1.1.0' }
      })

      const result = await tagManager.createTag(samplePackageVersion)

      expect(result).toBe('myorg-package/v1.1.0')
      expect(mockedCore.warning).toHaveBeenCalledWith(
        'Tag myorg-package/v1.1.0 already exists, skipping'
      )
      expect(mockedExec.exec).not.toHaveBeenCalled()
    })

    it('should handle git tag creation failure', async () => {
      mockedExec.exec.mockRejectedValueOnce(new Error('Git tag failed'))

      await expect(tagManager.createTag(samplePackageVersion)).rejects.toThrow('Git tag failed')
      expect(mockedCore.error).toHaveBeenCalledWith(
        'Failed to create tag myorg-package/v1.1.0: Error: Git tag failed'
      )
    })

    it('should handle git push failure', async () => {
      // Mock setTimeout to avoid actual delays in tests
      vi.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
        fn()
        return 0 as any
      })

      mockedExec.exec
        .mockResolvedValueOnce(0) // git tag succeeds
        .mockRejectedValue(new Error('Git push failed')) // all git push attempts fail

      await expect(tagManager.createTag(samplePackageVersion)).rejects.toThrow('Git push failed')
      expect(mockedCore.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create tag myorg-package/v1.1.0')
      )

      vi.restoreAllMocks()
    }, 10000)
  })

  describe('createRelease', () => {
    const changelog = '## @myorg/package v1.1.0\n\n### 🚀 Features\n- new feature'

    beforeEach(() => {
      mockOctokit.rest.repos.getReleaseByTag = vi.fn().mockRejectedValue(new Error('Not found'))
      mockOctokit.rest.repos.createRelease = vi.fn().mockResolvedValue({
        data: {
          html_url: 'https://github.com/testowner/testrepo/releases/tag/myorg-package-v1.1.0',
          id: 123,
          name: 'Myorg Package v1.1.0'
        }
      })
    })

    it('should create release successfully', async () => {
      const result = await tagManager.createRelease(samplePackageVersion, changelog)

      expect(result).toEqual({
        html_url: 'https://github.com/testowner/testrepo/releases/tag/myorg-package-v1.1.0',
        id: 123,
        name: 'Myorg Package v1.1.0'
      })

      expect(mockOctokit.rest.repos.createRelease).toHaveBeenCalledWith({
        owner: 'testowner',
        repo: 'testrepo',
        tag_name: 'myorg-package/v1.1.0',
        name: 'Myorg Package v1.1.0',
        body: changelog,
        draft: false,
        prerelease: false,
        generate_release_notes: false
      })

      expect(mockedCore.info).toHaveBeenCalledWith(
        'Created release: Myorg Package v1.1.0 (https://github.com/testowner/testrepo/releases/tag/myorg-package-v1.1.0)'
      )
    })

    it('should return null in dry run mode', async () => {
      const dryRunManager = new TagManager({ ...defaultConfig, dryRun: true })

      const result = await dryRunManager.createRelease(samplePackageVersion, changelog)

      expect(result).toBe(null)
      expect(mockedCore.info).toHaveBeenCalledWith(
        '[DRY RUN] Would create release: Myorg Package v1.1.0'
      )
      expect(mockOctokit.rest.repos.createRelease).not.toHaveBeenCalled()
    })

    it('should return existing release if it already exists', async () => {
      const existingRelease = {
        html_url: 'https://github.com/testowner/testrepo/releases/tag/existing',
        id: 456,
        name: 'Existing Release'
      }

      mockOctokit.rest.repos.getReleaseByTag = vi.fn().mockResolvedValue({
        data: existingRelease
      })

      const result = await tagManager.createRelease(samplePackageVersion, changelog)

      expect(result).toEqual(existingRelease)
      expect(mockedCore.warning).toHaveBeenCalledWith(
        'Release for tag myorg-package/v1.1.0 already exists'
      )
      expect(mockOctokit.rest.repos.createRelease).not.toHaveBeenCalled()
    })

    it('should detect prerelease versions', async () => {
      const prereleasePackage: PackageVersion = {
        ...samplePackageVersion,
        newVersion: '1.1.0-alpha.1'
      }

      await tagManager.createRelease(prereleasePackage, changelog)

      expect(mockOctokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          prerelease: true
        })
      )
    })

    it('should handle create release API failure', async () => {
      mockOctokit.rest.repos.createRelease = vi.fn().mockRejectedValue(new Error('API Error'))

      await expect(tagManager.createRelease(samplePackageVersion, changelog)).rejects.toThrow(
        'API Error'
      )
      expect(mockedCore.error).toHaveBeenCalledWith(
        'Failed to create release for myorg-package/v1.1.0: Error: API Error'
      )
    })
  })

  describe('formatTag', () => {
    it('should format NPM style tags', () => {
      const npmManager = new TagManager({ ...defaultConfig, tagFormat: 'npm' })

      expect(npmManager['formatTag']('@myorg/package', '1.1.0')).toBe('@myorg/package@v1.1.0')
      expect(npmManager['formatTag']('simple-package', '1.1.0')).toBe('simple-package@v1.1.0')
    })

    it('should format slash style tags', () => {
      const slashManager = new TagManager({ ...defaultConfig, tagFormat: 'slash' })

      expect(slashManager['formatTag']('@myorg/package', '1.1.0')).toBe('myorg-package/v1.1.0')
      expect(slashManager['formatTag']('simple-package', '1.1.0')).toBe('simple-package/v1.1.0')
    })

    it('should format standard style tags', () => {
      const standardManager = new TagManager({ ...defaultConfig, tagFormat: 'standard' })

      expect(standardManager['formatTag']('@myorg/package', '1.1.0')).toBe('v1.1.0')
      expect(standardManager['formatTag']('simple-package', '1.1.0')).toBe('v1.1.0')
    })

    it('should default to standard format for unknown formats', () => {
      const config = { ...defaultConfig, tagFormat: 'unknown' as any }
      const unknownManager = new TagManager(config)

      expect(unknownManager['formatTag']('@myorg/package', '1.1.0')).toBe('v1.1.0')
    })

    it('should handle complex scoped package names', () => {
      const slashManager = new TagManager({ ...defaultConfig, tagFormat: 'slash' })

      expect(slashManager['formatTag']('@org/nested/package', '1.0.0')).toBe(
        'org-nested-package/v1.0.0'
      )
    })
  })

  describe('formatReleaseName', () => {
    it('should format scoped package names', () => {
      expect(tagManager['formatReleaseName']('@myorg/package', '1.1.0')).toBe(
        'Myorg Package v1.1.0'
      )
    })

    it('should format simple package names', () => {
      expect(tagManager['formatReleaseName']('simple-package', '1.1.0')).toBe(
        'Simple-package v1.1.0'
      )
    })

    it('should handle single word package names', () => {
      expect(tagManager['formatReleaseName']('package', '1.1.0')).toBe('Package v1.1.0')
    })

    it('should handle complex nested package names', () => {
      expect(tagManager['formatReleaseName']('@org/nested/package', '1.1.0')).toBe(
        'Org Nested Package v1.1.0'
      )
    })

    it('should handle packages with hyphens', () => {
      expect(tagManager['formatReleaseName']('@myorg/my-awesome-package', '1.1.0')).toBe(
        'Myorg My-awesome-package v1.1.0'
      )
    })
  })

  describe('tagExists', () => {
    it('should return true when tag exists locally', async () => {
      mockedExec.getExecOutput.mockResolvedValue({
        stdout: 'abc123def456',
        stderr: '',
        exitCode: 0
      })

      const result = await tagManager['tagExists']('test-tag')

      expect(result).toBe(true)
      expect(mockedExec.getExecOutput).toHaveBeenCalledWith(
        'git',
        ['rev-parse', 'refs/tags/test-tag'],
        expect.objectContaining({
          ignoreReturnCode: true,
          cwd: expect.any(String)
        })
      )
    })

    it('should return true when tag exists remotely but not locally', async () => {
      mockedExec.getExecOutput.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1 // Tag doesn't exist locally
      })

      mockOctokit.rest.git.getRef = vi.fn().mockResolvedValue({
        data: { ref: 'refs/tags/test-tag' }
      })

      const result = await tagManager['tagExists']('test-tag')

      expect(result).toBe(true)
      expect(mockOctokit.rest.git.getRef).toHaveBeenCalledWith({
        owner: 'testowner',
        repo: 'testrepo',
        ref: 'tags/test-tag'
      })
    })

    it('should return false when tag exists nowhere', async () => {
      mockedExec.getExecOutput.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1
      })

      mockOctokit.rest.git.getRef = vi.fn().mockRejectedValue(new Error('Not found'))

      const result = await tagManager['tagExists']('test-tag')

      expect(result).toBe(false)
    })

    it('should return false when git operations fail', async () => {
      mockedExec.getExecOutput.mockRejectedValue(new Error('Git error'))

      const result = await tagManager['tagExists']('test-tag')

      expect(result).toBe(false)
    })

    it('should handle GitHub API errors gracefully', async () => {
      mockedExec.getExecOutput.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1
      })

      mockOctokit.rest.git.getRef = vi.fn().mockRejectedValue(new Error('API Error'))

      const result = await tagManager['tagExists']('test-tag')

      expect(result).toBe(false)
    })
  })

  describe('isPrerelease', () => {
    const prereleaseVersions = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-rc',
      '1.0.0-rc.1',
      '1.0.0-preview',
      '1.0.0-preview.1',
      '1.0.0-canary',
      '1.0.0-canary.abc123'
    ]

    const stableVersions = [
      '1.0.0',
      '1.1.0',
      '2.0.0',
      '1.0.1-stable', // Contains 'stable' not prerelease keywords
      '1.0.0-gamma' // Not a recognized prerelease keyword
    ]

    it('should identify prerelease versions', () => {
      prereleaseVersions.forEach(version => {
        expect(tagManager['isPrerelease'](version)).toBe(true)
      })
    })

    it('should identify stable versions', () => {
      stableVersions.forEach(version => {
        expect(tagManager['isPrerelease'](version)).toBe(false)
      })
    })
  })

  describe('integration tests', () => {
    it('should handle complete tag and release workflow', async () => {
      // Mock successful tag creation
      mockedExec.getExecOutput.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1 // Tag doesn't exist
      })
      mockedExec.exec.mockResolvedValue(0)
      mockOctokit.rest.git.getRef = vi.fn().mockRejectedValue(new Error('Not found'))

      // Mock successful release creation
      mockOctokit.rest.repos.getReleaseByTag = vi.fn().mockRejectedValue(new Error('Not found'))
      mockOctokit.rest.repos.createRelease = vi.fn().mockResolvedValue({
        data: {
          html_url: 'https://github.com/testowner/testrepo/releases/tag/myorg-package-v1.1.0',
          id: 123,
          name: 'Myorg Package v1.1.0'
        }
      })

      const changelog = '## Release notes'

      // Create tag
      const tagName = await tagManager.createTag(samplePackageVersion)
      expect(tagName).toBe('myorg-package/v1.1.0')

      // Create release
      const release = await tagManager.createRelease(samplePackageVersion, changelog)
      expect(release?.html_url).toBe(
        'https://github.com/testowner/testrepo/releases/tag/myorg-package-v1.1.0'
      )
    })

    it('should handle different tag formats in workflow', async () => {
      const formats: Array<'npm' | 'slash' | 'standard'> = ['npm', 'slash', 'standard']
      const expectedTags = {
        npm: '@myorg/package@v1.1.0',
        slash: 'myorg-package/v1.1.0',
        standard: 'v1.1.0'
      }

      for (const format of formats) {
        const manager = new TagManager({ ...defaultConfig, tagFormat: format })

        // Mock tag doesn't exist
        mockedExec.getExecOutput.mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 1
        })
        mockOctokit.rest.git.getRef = vi.fn().mockRejectedValue(new Error('Not found'))
        mockedExec.exec.mockResolvedValue(0)

        const tagName = await manager.createTag(samplePackageVersion)
        expect(tagName).toBe(expectedTags[format])
      }
    })

    it('should handle prerelease workflow', async () => {
      const prereleasePackage: PackageVersion = {
        ...samplePackageVersion,
        newVersion: '1.1.0-beta.1'
      }

      // Mock tag creation
      mockedExec.getExecOutput.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1
      })
      mockedExec.exec.mockResolvedValue(0)
      mockOctokit.rest.git.getRef = vi.fn().mockRejectedValue(new Error('Not found'))

      // Mock release creation
      mockOctokit.rest.repos.getReleaseByTag = vi.fn().mockRejectedValue(new Error('Not found'))
      mockOctokit.rest.repos.createRelease = vi.fn().mockResolvedValue({
        data: { html_url: 'https://example.com', id: 123 }
      })

      await tagManager.createTag(prereleasePackage)
      await tagManager.createRelease(prereleasePackage, 'changelog')

      expect(mockOctokit.rest.repos.createRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          tag_name: 'myorg-package/v1.1.0-beta.1',
          prerelease: true
        })
      )
    })
  })

  describe('error scenarios', () => {
    it('should handle tag existence check failures gracefully', async () => {
      mockedExec.getExecOutput.mockRejectedValue(new Error('Git failure'))
      mockOctokit.rest.git.getRef = vi.fn().mockRejectedValue(new Error('API failure'))

      // Should still attempt to create tag
      mockedExec.exec.mockResolvedValue(0)

      const result = await tagManager.createTag(samplePackageVersion)

      expect(result).toBe('myorg-package/v1.1.0')
      expect(mockedExec.exec).toHaveBeenCalled()
    })

    it('should handle existing release check failures gracefully', async () => {
      mockOctokit.rest.repos.getReleaseByTag = vi.fn().mockRejectedValue(new Error('API Error'))
      mockOctokit.rest.repos.createRelease = vi.fn().mockResolvedValue({
        data: { html_url: 'https://example.com', id: 123 }
      })

      // Should still attempt to create release
      const result = await tagManager.createRelease(samplePackageVersion, 'changelog')

      expect(result).toBeTruthy()
      expect(mockOctokit.rest.repos.createRelease).toHaveBeenCalled()
    })
  })
})
