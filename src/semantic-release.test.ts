import * as core from '@actions/core'
import * as exec from '@actions/exec'
import conventionalCommitsParser from 'conventional-commits-parser'
import * as semver from 'semver'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type SemanticReleaseConfig, SemanticReleaseParser } from '../src/semantic-release'
import type { Commit, Package, PackageVersion } from '../src/types'

// Mock all external dependencies
vi.mock('@actions/core')
vi.mock('@actions/exec')
vi.mock('conventional-commits-parser', () => ({
  default: {
    sync: vi.fn()
  }
}))
vi.mock('semver')

const mockedCore = vi.mocked(core)
const mockedExec = vi.mocked(exec)
const mockedParseCommit = vi.mocked(conventionalCommitsParser.sync)
const mockedSemver = vi.mocked(semver)

describe('SemanticReleaseParser', () => {
  let semanticParser: SemanticReleaseParser
  let defaultConfig: SemanticReleaseConfig

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
    },
    {
      name: 'simple-package',
      path: 'packages/simple',
      version: '0.1.0'
    }
  ]

  beforeEach(() => {
    vi.clearAllMocks()

    defaultConfig = {
      enabled: true
    }

    semanticParser = new SemanticReleaseParser(defaultConfig)

    // Mock semver.inc
    mockedSemver.inc.mockImplementation((version: string, release: string) => {
      const versionMap: Record<string, Record<string, string>> = {
        '1.0.0': { patch: '1.0.1', minor: '1.1.0', major: '2.0.0' },
        '2.0.0': { patch: '2.0.1', minor: '2.1.0', major: '3.0.0' },
        '0.1.0': { patch: '0.1.1', minor: '0.2.0', major: '1.0.0' },
        '0.0.0': { patch: '0.0.1', minor: '0.1.0', major: '1.0.0' }
      }
      return versionMap[version]?.[release] || null
    })

    // Mock semver.gt
    mockedSemver.gt.mockImplementation((a: string, b: string) => {
      const versions: Record<string, number> = {
        '0.0.0': 0,
        '0.0.1': 1,
        '0.1.0': 2,
        '0.1.1': 3,
        '0.2.0': 4,
        '1.0.0': 10,
        '1.0.1': 11,
        '1.1.0': 12,
        '2.0.0': 20,
        '2.0.1': 21,
        '2.1.0': 22,
        '3.0.0': 30
      }
      return (versions[a] || 0) > (versions[b] || 0)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should initialize with default config', () => {
      expect(semanticParser).toBeInstanceOf(SemanticReleaseParser)
    })

    it('should use custom types when provided', () => {
      const customConfig: SemanticReleaseConfig = {
        enabled: true,
        types: {
          feat: 'major',
          fix: 'minor'
        }
      }

      const parser = new SemanticReleaseParser(customConfig)
      expect(parser).toBeInstanceOf(SemanticReleaseParser)
    })

    it('should handle disabled conventional commits', () => {
      const disabledConfig: SemanticReleaseConfig = {
        enabled: false
      }

      const parser = new SemanticReleaseParser(disabledConfig)
      expect(parser).toBeInstanceOf(SemanticReleaseParser)
    })
  })

  describe('analyzeCommits', () => {
    beforeEach(() => {
      // Mock parseCommit for conventional commits
      mockedParseCommit
        .mockReturnValueOnce({
          type: 'feat',
          scope: null,
          subject: 'new feature',
          notes: []
        })
        .mockReturnValueOnce({
          type: 'fix',
          scope: null,
          subject: 'bug fix',
          notes: []
        })

      // Mock getCommits behavior (describe + log) then diff-tree calls
      mockedExec.getExecOutput
        .mockResolvedValueOnce({
          // git describe --tags
          stdout: 'v1.0.0',
          stderr: '',
          exitCode: 0
        })
        .mockResolvedValueOnce({
          // git log
          stdout:
            'abc123|||feat: new feature|||Added new functionality\ndef456|||fix: bug fix|||Fixed critical bug',
          stderr: '',
          exitCode: 0
        })
        .mockResolvedValueOnce({
          // git diff-tree for commit abc123
          stdout: 'packages/package-a/src/index.ts\npackages/package-a/README.md',
          stderr: '',
          exitCode: 0
        })
        .mockResolvedValueOnce({
          // git diff-tree for commit def456
          stdout: 'packages/package-a/src/index.ts',
          stderr: '',
          exitCode: 0
        })
    })

    it('should analyze commits and return package versions', async () => {
      const result = await semanticParser.analyzeCommits([samplePackages[0]])

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        ...samplePackages[0],
        currentVersion: '1.0.0',
        newVersion: '1.1.0',
        releaseType: 'minor',
        commits: expect.arrayContaining([
          expect.objectContaining({
            sha: 'abc123',
            type: 'feat',
            breaking: false
          })
        ])
      })
    })

    it('should handle packages with no relevant commits', async () => {
      // Reset all mocks completely
      vi.resetAllMocks()

      // Create a new parser with disabled conventional commits to avoid complexities
      const nonConventionalParser = new SemanticReleaseParser({ enabled: false })

      // Mock semver methods
      mockedSemver.inc.mockImplementation((version: string, release: string) => {
        const versionMap: Record<string, Record<string, string>> = {
          '1.0.0': { patch: '1.0.1', minor: '1.1.0', major: '2.0.0' }
        }
        return versionMap[version]?.[release] || null
      })
      mockedSemver.gt.mockImplementation((a: string, b: string) => {
        const versions: Record<string, number> = {
          '1.0.0': 10,
          '1.0.1': 11,
          '1.1.0': 12,
          '2.0.0': 20
        }
        return (versions[a] || 0) > (versions[b] || 0)
      })

      // Mock no files affected and no commits found
      mockedExec.getExecOutput
        .mockResolvedValueOnce({ stdout: 'v1.0.0', stderr: '', exitCode: 0 }) // git describe
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // git log - empty commit log
        .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }) // any other git commands

      const result = await nonConventionalParser.analyzeCommits([samplePackages[0]])

      expect(result).toHaveLength(0)
    })

    it('should handle packages with version 0.0.0', async () => {
      const packageWithNoVersion: Package = {
        ...samplePackages[0],
        version: undefined
      }

      const result = await semanticParser.analyzeCommits([packageWithNoVersion])

      expect(mockedSemver.inc).toHaveBeenCalledWith('0.0.0', 'minor')
    })

    it('should skip packages where semver.inc returns null', async () => {
      mockedSemver.inc.mockReturnValue(null)

      const result = await semanticParser.analyzeCommits([samplePackages[0]])

      expect(result).toHaveLength(0)
    })
  })

  describe('getCommits', () => {
    it('should get commits since last tag', async () => {
      mockedExec.getExecOutput
        .mockResolvedValueOnce({
          // git describe
          stdout: 'v1.0.0',
          stderr: '',
          exitCode: 0
        })
        .mockResolvedValueOnce({
          // git log
          stdout: 'abc123|||feat: new feature|||Body content',
          stderr: '',
          exitCode: 0
        })

      mockedParseCommit.mockReturnValue({
        type: 'feat',
        scope: 'api',
        subject: 'new feature',
        notes: []
      })

      const commits = await semanticParser['getCommits']()

      expect(mockedExec.getExecOutput).toHaveBeenCalledWith('git', [
        'describe',
        '--tags',
        '--abbrev=0'
      ])
      expect(mockedExec.getExecOutput).toHaveBeenCalledWith('git', [
        'log',
        'v1.0.0..HEAD',
        '--pretty=format:%H|||%s|||%b',
        '--max-count=1000'
      ])

      expect(commits).toHaveLength(1)
      expect(commits[0]).toEqual({
        sha: 'abc123',
        message: 'feat: new feature\n\nBody content',
        type: 'feat',
        scope: 'api',
        breaking: false
      })
    })

    it('should get all commits when no tags exist', async () => {
      mockedExec.getExecOutput
        .mockRejectedValueOnce(new Error('No tags found')) // git describe fails
        .mockResolvedValueOnce({
          // git log
          stdout: 'abc123|||feat: new feature|||',
          stderr: '',
          exitCode: 0
        })

      mockedParseCommit.mockReturnValue({
        type: 'feat',
        scope: null,
        subject: 'new feature',
        notes: []
      })

      const commits = await semanticParser['getCommits']()

      expect(mockedCore.debug).toHaveBeenCalledWith('No previous tags found, analyzing all commits')
      expect(mockedExec.getExecOutput).toHaveBeenCalledWith('git', [
        'log',
        '--pretty=format:%H|||%s|||%b',
        '--max-count=1000'
      ])

      expect(commits).toHaveLength(1)
    })

    it('should detect breaking changes from commit notes', async () => {
      mockedExec.getExecOutput
        .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 1 }) // no tags
        .mockResolvedValueOnce({
          stdout: 'abc123|||feat!: breaking change|||BREAKING CHANGE: API changed',
          stderr: '',
          exitCode: 0
        })

      mockedParseCommit.mockReturnValue({
        type: 'feat',
        scope: null,
        subject: 'breaking change',
        notes: [{ title: 'BREAKING CHANGE', text: 'API changed' }]
      })

      const commits = await semanticParser['getCommits']()

      expect(commits[0].breaking).toBe(true)
    })

    it('should handle commits without conventional commits parsing', async () => {
      const disabledParser = new SemanticReleaseParser({ enabled: false })

      mockedExec.getExecOutput.mockRejectedValueOnce(new Error('No tags')).mockResolvedValueOnce({
        stdout: 'abc123|||Regular commit message|||',
        stderr: '',
        exitCode: 0
      })

      const commits = await disabledParser['getCommits']()

      expect(commits).toHaveLength(1)
      expect(commits[0]).toEqual({
        sha: 'abc123',
        message: 'Regular commit message'
      })
      expect(mockedParseCommit).not.toHaveBeenCalled()
    })

    it('should handle empty commit output', async () => {
      mockedExec.getExecOutput.mockRejectedValueOnce(new Error('No tags')).mockResolvedValueOnce({
        stdout: '',
        stderr: '',
        exitCode: 0
      })

      const commits = await semanticParser['getCommits']()

      expect(commits).toHaveLength(0)
    })

    it('should handle git log errors', async () => {
      mockedExec.getExecOutput
        .mockRejectedValueOnce(new Error('No tags'))
        .mockRejectedValueOnce(new Error('Git log failed'))

      const commits = await semanticParser['getCommits']()

      expect(mockedCore.warning).toHaveBeenCalledWith(
        'Failed to get commits: Error: Git log failed'
      )
      expect(commits).toHaveLength(0)
    })

    it('should handle malformed commit lines', async () => {
      mockedExec.getExecOutput.mockRejectedValueOnce(new Error('No tags')).mockResolvedValueOnce({
        stdout:
          'abc123|||feat: new feature\ndef456|||incomplete line\nghi789|||fix: bug fix|||body',
        stderr: '',
        exitCode: 0
      })

      mockedParseCommit
        .mockReturnValueOnce({ type: 'feat', scope: null, subject: 'new feature', notes: [] })
        .mockReturnValueOnce({ type: null, scope: null, subject: 'incomplete line', notes: [] })
        .mockReturnValueOnce({ type: 'fix', scope: null, subject: 'bug fix', notes: [] })

      const commits = await semanticParser['getCommits']()

      expect(commits).toHaveLength(3)
      expect(commits[1]).toEqual({
        sha: 'def456',
        message: 'incomplete line',
        type: undefined,
        scope: undefined,
        breaking: false
      })
    })
  })

  describe('filterCommitsForPackage', () => {
    const sampleCommits: Commit[] = [
      {
        sha: 'abc123',
        message: 'feat: new feature',
        type: 'feat'
      },
      {
        sha: 'def456',
        message: 'fix(package-a): bug fix',
        type: 'fix',
        scope: 'package-a'
      },
      {
        sha: 'ghi789',
        message: 'docs: update readme',
        type: 'docs'
      }
    ]

    it('should filter commits that affect package files', async () => {
      mockedExec.getExecOutput
        .mockResolvedValueOnce({
          // abc123
          stdout: 'packages/package-a/src/index.ts\npackages/package-a/README.md',
          stderr: '',
          exitCode: 0
        })
        .mockResolvedValueOnce({
          // def456
          stdout: 'other-package/file.ts',
          stderr: '',
          exitCode: 0
        })
        .mockResolvedValueOnce({
          // ghi789
          stdout: 'README.md\nDOCS.md',
          stderr: '',
          exitCode: 0
        })

      const result = await semanticParser['filterCommitsForPackage'](
        sampleCommits,
        samplePackages[0]
      )

      expect(result).toHaveLength(2) // abc123 affects files + def456 has matching scope
      expect(result.map(c => c.sha)).toEqual(['abc123', 'def456'])
    })

    it('should include commits with matching scope', async () => {
      mockedExec.getExecOutput.mockResolvedValue({
        stdout: 'other-files.ts',
        stderr: '',
        exitCode: 0
      })

      const result = await semanticParser['filterCommitsForPackage'](
        sampleCommits,
        samplePackages[0]
      )

      expect(result).toHaveLength(1) // Only def456 with matching scope
      expect(result[0].sha).toBe('def456')
    })

    it('should handle git diff-tree errors', async () => {
      mockedExec.getExecOutput.mockRejectedValue(new Error('Git diff-tree failed'))

      const result = await semanticParser['filterCommitsForPackage'](
        sampleCommits,
        samplePackages[0]
      )

      expect(result).toHaveLength(1) // Only scope-based matching works
      expect(result[0].sha).toBe('def456')
      expect(mockedCore.debug).toHaveBeenCalledWith(
        'Batch file processing failed, falling back to individual: Error: Git diff-tree failed'
      )
    })

    it('should not duplicate commits found by both file and scope matching', async () => {
      mockedExec.getExecOutput.mockResolvedValue({
        stdout: 'packages/package-a/index.ts',
        stderr: '',
        exitCode: 0
      })

      const result = await semanticParser['filterCommitsForPackage'](
        sampleCommits,
        samplePackages[0]
      )

      // def456 matches both file path and scope, should only appear once
      expect(result.filter(c => c.sha === 'def456')).toHaveLength(1)
    })

    it('should handle empty file lists', async () => {
      mockedExec.getExecOutput.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0
      })

      const result = await semanticParser['filterCommitsForPackage'](
        sampleCommits,
        samplePackages[0]
      )

      expect(result).toHaveLength(1) // Only scope matching
    })
  })

  describe('isPackageScope', () => {
    it('should match exact package name', () => {
      expect(semanticParser['isPackageScope']('@myorg/package-a', '@myorg/package-a')).toBe(true)
    })

    it('should match simple package name from scoped package', () => {
      expect(semanticParser['isPackageScope']('package-a', '@myorg/package-a')).toBe(true)
    })

    it('should match unscoped package name', () => {
      expect(semanticParser['isPackageScope']('simple-package', 'simple-package')).toBe(true)
    })

    it('should not match different package names', () => {
      expect(semanticParser['isPackageScope']('package-b', '@myorg/package-a')).toBe(false)
    })

    it('should handle edge cases', () => {
      expect(semanticParser['isPackageScope']('', '@myorg/package-a')).toBe(false)
      expect(semanticParser['isPackageScope']('test', '')).toBe(false)
    })
  })

  describe('determineReleaseType', () => {
    it('should return major for breaking changes', () => {
      const commits: Commit[] = [
        {
          sha: 'abc123',
          message: 'feat: new feature',
          type: 'feat',
          breaking: true
        }
      ]

      const result = semanticParser['determineReleaseType'](commits)
      expect(result).toBe('major')
    })

    it('should return major for BREAKING CHANGE in message', () => {
      const commits: Commit[] = [
        {
          sha: 'abc123',
          message: 'feat: new feature\n\nBREAKING CHANGE: API changed',
          type: 'feat'
        }
      ]

      const result = semanticParser['determineReleaseType'](commits)
      expect(result).toBe('major')
    })

    it('should return minor for feat commits', () => {
      const commits: Commit[] = [
        {
          sha: 'abc123',
          message: 'feat: new feature',
          type: 'feat'
        }
      ]

      const result = semanticParser['determineReleaseType'](commits)
      expect(result).toBe('minor')
    })

    it('should return patch for fix commits', () => {
      const commits: Commit[] = [
        {
          sha: 'abc123',
          message: 'fix: bug fix',
          type: 'fix'
        }
      ]

      const result = semanticParser['determineReleaseType'](commits)
      expect(result).toBe('patch')
    })

    it('should prioritize minor over patch', () => {
      const commits: Commit[] = [
        {
          sha: 'abc123',
          message: 'fix: bug fix',
          type: 'fix'
        },
        {
          sha: 'def456',
          message: 'feat: new feature',
          type: 'feat'
        }
      ]

      const result = semanticParser['determineReleaseType'](commits)
      expect(result).toBe('minor')
    })

    it('should return null for no relevant commits', () => {
      const commits: Commit[] = []

      const result = semanticParser['determineReleaseType'](commits)
      expect(result).toBe(null)
    })

    it('should handle commits without types', () => {
      const commits: Commit[] = [
        {
          sha: 'abc123',
          message: 'regular commit message'
        }
      ]

      const result = semanticParser['determineReleaseType'](commits)
      expect(result).toBe(null)
    })

    it('should use custom type mappings', () => {
      const customParser = new SemanticReleaseParser({
        enabled: true,
        types: {
          feat: 'patch', // Custom: feat -> patch instead of minor
          fix: 'minor' // Custom: fix -> minor instead of patch
        }
      })

      const commits: Commit[] = [
        {
          sha: 'abc123',
          message: 'feat: new feature',
          type: 'feat'
        }
      ]

      const result = customParser['determineReleaseType'](commits)
      expect(result).toBe('patch')
    })

    it('should return patch when conventional commits disabled', () => {
      const disabledParser = new SemanticReleaseParser({ enabled: false })

      const commits: Commit[] = [
        {
          sha: 'abc123',
          message: 'any commit message'
        }
      ]

      const result = disabledParser['determineReleaseType'](commits)
      expect(result).toBe('patch')
    })

    it('should return null when no commits and conventional commits disabled', () => {
      const disabledParser = new SemanticReleaseParser({ enabled: false })

      const result = disabledParser['determineReleaseType']([])
      expect(result).toBe(null)
    })

    it('should handle unknown commit types', () => {
      const commits: Commit[] = [
        {
          sha: 'abc123',
          message: 'unknown: some change',
          type: 'unknown'
        }
      ]

      const result = semanticParser['determineReleaseType'](commits)
      expect(result).toBe(null)
    })

    it('should handle all default commit types', () => {
      const typeTests = [
        { type: 'feat', expected: 'minor' },
        { type: 'fix', expected: 'patch' },
        { type: 'perf', expected: 'patch' },
        { type: 'revert', expected: 'patch' },
        { type: 'docs', expected: 'patch' },
        { type: 'style', expected: 'patch' },
        { type: 'refactor', expected: 'patch' },
        { type: 'test', expected: 'patch' },
        { type: 'build', expected: 'patch' },
        { type: 'ci', expected: 'patch' },
        { type: 'chore', expected: 'patch' }
      ]

      for (const { type, expected } of typeTests) {
        const commits: Commit[] = [
          {
            sha: 'abc123',
            message: `${type}: some change`,
            type
          }
        ]

        const result = semanticParser['determineReleaseType'](commits)
        expect(result).toBe(expected)
      }
    })
  })

  describe('integration tests', () => {
    it('should handle complete workflow with multiple packages', async () => {
      // Mock git operations
      mockedExec.getExecOutput
        .mockResolvedValueOnce({ stdout: 'v1.0.0', stderr: '', exitCode: 0 }) // git describe
        .mockResolvedValueOnce({
          // git log
          stdout:
            'abc123|||feat(package-a): new feature|||Feature description\ndef456|||fix: general fix|||Bug fix description',
          stderr: '',
          exitCode: 0
        })
        // Mock git diff-tree calls for batch processing - should return files for both commits
        .mockResolvedValueOnce({
          stdout: 'packages/package-a/src/index.ts\npackages/package-a/README.md',
          stderr: '',
          exitCode: 0
        })

      // Mock conventional commit parsing
      mockedParseCommit
        .mockReturnValueOnce({
          type: 'feat',
          scope: 'package-a',
          subject: 'new feature',
          notes: []
        })
        .mockReturnValueOnce({
          type: 'fix',
          scope: null,
          subject: 'general fix',
          notes: []
        })

      const result = await semanticParser.analyzeCommits(samplePackages.slice(0, 2))

      expect(result).toHaveLength(1) // Only package-a should get a release
      expect(result[0]).toMatchObject({
        name: '@myorg/package-a',
        currentVersion: '1.0.0',
        newVersion: '1.1.0',
        releaseType: 'minor'
      })
      expect(result[0].commits).toHaveLength(1) // With batch processing, only scope-based matching works in this test
    })
  })
})
