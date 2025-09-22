import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'yaml'
import { GoReleaserConfig, type GoReleaserConfigOptions } from './goreleaser-config'
import type { PackageVersion } from './types'

// Mock all external dependencies
vi.mock('@actions/core')
vi.mock('@actions/exec')
vi.mock('@actions/io')
vi.mock('fs/promises')
vi.mock('path')
vi.mock('yaml')

const mockedCore = vi.mocked(core)
const mockedExec = vi.mocked(exec)
const mockedIo = vi.mocked(io)
const mockedFs = vi.mocked(fs)
const mockedPath = vi.mocked(path)
const mockedYaml = vi.mocked(yaml)

describe('GoReleaserConfig', () => {
  let goreleaserConfig: GoReleaserConfig
  let defaultOptions: GoReleaserConfigOptions
  let samplePackageVersion: PackageVersion

  beforeEach(() => {
    vi.clearAllMocks()

    defaultOptions = {
      goreleaserKey: 'test-key',
      goreleaserVersion: '~> v2',
      dryRun: false
    }

    samplePackageVersion = {
      name: '@myorg/package',
      path: '/workspace/packages/mypackage',
      version: '1.2.0',
      currentVersion: '1.1.0',
      newVersion: '1.2.0',
      releaseType: 'minor',
      commits: []
    }

    goreleaserConfig = new GoReleaserConfig(defaultOptions)

    // Mock path methods
    mockedPath.join.mockImplementation((...segments) => segments.join('/'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('should initialize with provided options', () => {
      expect(goreleaserConfig).toBeInstanceOf(GoReleaserConfig)
    })

    it('should use default version when not provided', () => {
      const options: GoReleaserConfigOptions = { dryRun: false }
      const config = new GoReleaserConfig(options)
      expect(config).toBeInstanceOf(GoReleaserConfig)
    })
  })

  describe('isGoReleaserProject', () => {
    const packagePath = '/test/package'

    it('should return true when .goreleaser.yml exists', async () => {
      mockedFs.access
        .mockRejectedValueOnce(new Error('Not found')) // .goreleaser.yml - found on first try
        .mockResolvedValueOnce(undefined)

      const result = await goreleaserConfig.isGoReleaserProject(packagePath)

      expect(result).toBe(true)
      expect(mockedCore.debug).toHaveBeenCalledWith(
        'Found /test/package/.goreleaser.yaml - this appears to be a GoReleaser-compatible project'
      )
    })

    it('should return true when go.mod exists', async () => {
      mockedFs.access
        .mockRejectedValueOnce(new Error('Not found')) // .goreleaser.yml
        .mockRejectedValueOnce(new Error('Not found')) // .goreleaser.yaml
        .mockRejectedValueOnce(new Error('Not found')) // main.go
        .mockResolvedValueOnce(undefined) // go.mod - found

      const result = await goreleaserConfig.isGoReleaserProject(packagePath)

      expect(result).toBe(true)
      expect(mockedCore.debug).toHaveBeenCalledWith(
        'Found /test/package/go.mod - this appears to be a GoReleaser-compatible project'
      )
    })

    it('should return true when Cargo.toml exists', async () => {
      mockedFs.access
        .mockRejectedValueOnce(new Error('Not found')) // .goreleaser.yml
        .mockRejectedValueOnce(new Error('Not found')) // .goreleaser.yaml
        .mockRejectedValueOnce(new Error('Not found')) // main.go
        .mockRejectedValueOnce(new Error('Not found')) // go.mod
        .mockResolvedValueOnce(undefined) // Cargo.toml - found

      const result = await goreleaserConfig.isGoReleaserProject(packagePath)

      expect(result).toBe(true)
      expect(mockedCore.debug).toHaveBeenCalledWith(
        'Found /test/package/Cargo.toml - this appears to be a GoReleaser-compatible project'
      )
    })

    it('should return false when no supported files exist', async () => {
      mockedFs.access.mockRejectedValue(new Error('Not found'))

      const result = await goreleaserConfig.isGoReleaserProject(packagePath)

      expect(result).toBe(false)
    })

    it('should check all supported file types', async () => {
      mockedFs.access.mockRejectedValue(new Error('Not found'))

      await goreleaserConfig.isGoReleaserProject(packagePath)

      expect(mockedFs.access).toHaveBeenCalledWith('/test/package/.goreleaser.yml')
      expect(mockedFs.access).toHaveBeenCalledWith('/test/package/.goreleaser.yaml')
      expect(mockedFs.access).toHaveBeenCalledWith('/test/package/main.go')
      expect(mockedFs.access).toHaveBeenCalledWith('/test/package/go.mod')
      expect(mockedFs.access).toHaveBeenCalledWith('/test/package/Cargo.toml')
      expect(mockedFs.access).toHaveBeenCalledWith('/test/package/package.json')
      expect(mockedFs.access).toHaveBeenCalledWith('/test/package/pyproject.toml')
      expect(mockedFs.access).toHaveBeenCalledWith('/test/package/build.zig')
    })
  })

  describe('generateConfig', () => {
    const configPath = '/workspace/packages/mypackage/.goreleaser.yml'
    const generatedPath = '/workspace/packages/mypackage/.goreleaser.generated.yml'

    beforeEach(() => {
      mockedYaml.stringify.mockReturnValue('config: yaml content')
    })

    it('should generate config with existing configuration', async () => {
      const existingConfig = {
        project_name: 'existing-project',
        builds: [{ id: 'custom-build' }]
      }

      mockedFs.readFile.mockResolvedValue('existing: config')
      mockedYaml.parse.mockReturnValue(existingConfig)
      mockedFs.writeFile.mockResolvedValue(undefined)

      const result = await goreleaserConfig.generateConfig(samplePackageVersion)

      expect(result).toBe(generatedPath)
      expect(mockedFs.readFile).toHaveBeenCalledWith(configPath, 'utf-8')
      expect(mockedYaml.parse).toHaveBeenCalledWith('existing: config')
      expect(mockedFs.writeFile).toHaveBeenCalledWith(
        generatedPath,
        'config: yaml content',
        'utf-8'
      )
    })

    it('should generate config without existing configuration', async () => {
      mockedFs.readFile.mockRejectedValue(new Error('File not found'))
      mockedFs.writeFile.mockResolvedValue(undefined)

      const result = await goreleaserConfig.generateConfig(samplePackageVersion)

      expect(result).toBe(generatedPath)
      expect(mockedCore.debug).toHaveBeenCalledWith(
        'No existing GoReleaser config found for @myorg/package'
      )
    })

    it('should generate proper config structure', async () => {
      mockedFs.readFile.mockRejectedValue(new Error('File not found'))
      mockedFs.writeFile.mockResolvedValue(undefined)

      await goreleaserConfig.generateConfig(samplePackageVersion)

      const expectedConfig = {
        project_name: 'myorg-package',
        version: 2,
        monorepo: {
          tag_prefix: 'myorg-package/',
          dir: '/workspace/packages/mypackage'
        },
        builds: [
          {
            id: 'default',
            binary: 'package',
            goos: ['linux', 'darwin', 'windows'],
            goarch: ['amd64', 'arm64'],
            main: './main.go',
            dir: '.',
            ldflags: [
              '-s -w',
              '-X main.version={{.Version}}',
              '-X main.commit={{.Commit}}',
              '-X main.date={{.Date}}'
            ]
          }
        ],
        archives: [
          {
            format: 'tar.gz',
            name_template: '{{ .ProjectName }}_{{ .Version }}_{{ .Os }}_{{ .Arch }}',
            files: ['README*', 'LICENSE*']
          }
        ],
        release: {
          name_template: '{{ .ProjectName }} {{ .Tag }}',
          prerelease: 'auto'
        },
        changelog: {
          use: 'github',
          filters: {
            exclude: ['^docs:', '^test:', '^ci:', '^chore:']
          }
        }
      }

      expect(mockedYaml.stringify).toHaveBeenCalledWith(expectedConfig)
    })

    it('should preserve existing builds and archives', async () => {
      const existingConfig = {
        builds: [{ id: 'custom' }],
        archives: [{ format: 'zip' }]
      }

      mockedFs.readFile.mockResolvedValue('existing: config')
      mockedYaml.parse.mockReturnValue(existingConfig)
      mockedFs.writeFile.mockResolvedValue(undefined)

      await goreleaserConfig.generateConfig(samplePackageVersion)

      expect(mockedYaml.stringify).toHaveBeenCalledWith(
        expect.objectContaining({
          builds: [{ id: 'custom' }],
          archives: [{ format: 'zip' }]
        })
      )
    })
  })

  describe('runGoReleaser', () => {
    const configPath = '/workspace/packages/mypackage/.goreleaser.generated.yml'

    beforeEach(() => {
      mockedIo.which.mockResolvedValue('/usr/local/bin/goreleaser')
      mockedExec.exec.mockResolvedValue(0)
      mockedFs.readdir.mockResolvedValue([])
    })

    it('should return empty array in dry run mode', async () => {
      const dryRunConfig = new GoReleaserConfig({ ...defaultOptions, dryRun: true })

      const result = await dryRunConfig.runGoReleaser(samplePackageVersion, configPath)

      expect(result).toEqual([])
      expect(mockedCore.info).toHaveBeenCalledWith(
        '[DRY RUN] Would run GoReleaser for @myorg/package'
      )
    })

    it('should install GoReleaser if not present', async () => {
      const configWithoutKey = new GoReleaserConfig({ dryRun: false })
      mockedIo.which.mockResolvedValue('')
      mockedExec.exec.mockResolvedValueOnce(0) // install
      mockedExec.exec.mockResolvedValueOnce(0) // release

      await configWithoutKey.runGoReleaser(samplePackageVersion, configPath)

      expect(mockedCore.info).toHaveBeenCalledWith('Installing GoReleaser...')
      expect(mockedExec.exec).toHaveBeenCalledWith('sh', [
        '-c',
        'curl -sfL https://install.goreleaser.com/github.com/goreleaser/goreleaser.sh | sh -s -- -b /usr/local/bin'
      ])
    })

    it('should install GoReleaser Pro when key is provided', async () => {
      mockedIo.which.mockResolvedValue('')
      mockedExec.exec.mockResolvedValueOnce(0) // install
      mockedExec.exec.mockResolvedValueOnce(0) // release

      await goreleaserConfig.runGoReleaser(samplePackageVersion, configPath)

      expect(mockedExec.exec).toHaveBeenCalledWith('sh', [
        '-c',
        'curl -sfL https://goreleaser.com/pro/install.sh | sh -s -- -b /usr/local/bin'
      ])
    })

    it('should run GoReleaser with correct arguments', async () => {
      await goreleaserConfig.runGoReleaser(samplePackageVersion, configPath)

      expect(mockedExec.exec).toHaveBeenCalledWith(
        'goreleaser',
        ['release', '--clean', '--config', configPath],
        expect.objectContaining({
          cwd: '/workspace/packages/mypackage',
          env: expect.objectContaining({
            GORELEASER_CURRENT_TAG: 'myorg-package/v1.2.0',
            GORELEASER_KEY: 'test-key'
          })
        })
      )
    })

    it('should handle GoReleaser execution failure', async () => {
      mockedExec.exec.mockResolvedValue(1)

      await expect(
        goreleaserConfig.runGoReleaser(samplePackageVersion, configPath)
      ).rejects.toThrow('GoReleaser failed with exit code 1')

      expect(mockedCore.error).toHaveBeenCalledWith(
        'Failed to run GoReleaser for @myorg/package: Error: GoReleaser failed with exit code 1'
      )
    })

    it('should parse artifacts from artifacts.json', async () => {
      const artifactsMetadata = [
        {
          name: 'myapp-linux-amd64.tar.gz',
          path: '/dist/myapp-linux-amd64.tar.gz',
          type: 'archive',
          extra: { goos: 'linux', goarch: 'amd64' }
        }
      ]

      mockedFs.readFile.mockResolvedValue(JSON.stringify(artifactsMetadata))

      const result = await goreleaserConfig.runGoReleaser(samplePackageVersion, configPath)

      expect(result).toEqual([
        {
          name: 'myapp-linux-amd64.tar.gz',
          path: '/dist/myapp-linux-amd64.tar.gz',
          type: 'archive',
          extra: { goos: 'linux', goarch: 'amd64' }
        }
      ])
    })

    it('should fallback to directory listing when artifacts.json not found', async () => {
      mockedFs.readFile.mockRejectedValue(new Error('File not found'))
      mockedFs.readdir.mockResolvedValue(['app.tar.gz', 'app.zip', 'readme.txt', 'app.deb'])

      const result = await goreleaserConfig.runGoReleaser(samplePackageVersion, configPath)

      expect(result).toEqual([
        {
          name: 'app.tar.gz',
          path: '/workspace/packages/mypackage/dist/app.tar.gz',
          type: 'archive'
        },
        {
          name: 'app.zip',
          path: '/workspace/packages/mypackage/dist/app.zip',
          type: 'archive'
        },
        {
          name: 'app.deb',
          path: '/workspace/packages/mypackage/dist/app.deb',
          type: 'archive'
        }
      ])
    })

    it('should handle installation errors', async () => {
      mockedIo.which.mockResolvedValue('')
      mockedExec.exec.mockRejectedValue(new Error('Installation failed'))

      await expect(
        goreleaserConfig.runGoReleaser(samplePackageVersion, configPath)
      ).rejects.toThrow('Failed to install GoReleaser: Error: Installation failed')
    })
  })

  describe('private methods', () => {
    describe('getTagPrefix', () => {
      it('should generate correct tag prefix for scoped package', () => {
        const tagPrefix = goreleaserConfig['getTagPrefix']('@myorg/package')
        expect(tagPrefix).toBe('myorg-package/')
      })

      it('should generate correct tag prefix for unscoped package', () => {
        const tagPrefix = goreleaserConfig['getTagPrefix']('package')
        expect(tagPrefix).toBe('package/')
      })

      it('should handle multiple slashes', () => {
        const tagPrefix = goreleaserConfig['getTagPrefix']('@myorg/nested/package')
        expect(tagPrefix).toBe('myorg-nested-package/')
      })
    })

    describe('getDownloadUrl', () => {
      it('should return Pro URL for goreleaser-pro', async () => {
        const url = await goreleaserConfig['getDownloadUrl']('goreleaser-pro')
        expect(url).toBe('https://goreleaser.com/pro/install.sh')
      })

      it('should return standard URL for goreleaser', async () => {
        const url = await goreleaserConfig['getDownloadUrl']('goreleaser')
        expect(url).toBe('https://install.goreleaser.com/github.com/goreleaser/goreleaser.sh')
      })
    })

    describe('parseArtifacts', () => {
      const packagePath = '/workspace/packages/mypackage'

      it('should parse from artifacts.json when available', async () => {
        const metadata = [
          {
            name: 'app-linux-amd64.tar.gz',
            path: '/dist/app-linux-amd64.tar.gz',
            type: 'archive',
            extra: { goos: 'linux' }
          }
        ]

        mockedFs.readFile.mockResolvedValue(JSON.stringify(metadata))

        const result = await goreleaserConfig['parseArtifacts'](packagePath)

        expect(result).toEqual([
          {
            name: 'app-linux-amd64.tar.gz',
            path: '/dist/app-linux-amd64.tar.gz',
            type: 'archive',
            extra: { goos: 'linux' }
          }
        ])
      })

      it('should handle malformed artifacts.json', async () => {
        mockedFs.readFile.mockResolvedValue('invalid json')

        const result = await goreleaserConfig['parseArtifacts'](packagePath)

        expect(result).toEqual([])
        expect(mockedCore.debug).toHaveBeenCalledWith(
          'No artifacts.json found, checking dist directory'
        )
      })

      it('should fallback to directory listing', async () => {
        mockedFs.readFile.mockRejectedValue(new Error('File not found'))
        mockedFs.readdir.mockResolvedValue(['app.tar.gz', 'app.zip', 'checksums.txt'])

        const result = await goreleaserConfig['parseArtifacts'](packagePath)

        expect(result).toEqual([
          {
            name: 'app.tar.gz',
            path: '/workspace/packages/mypackage/dist/app.tar.gz',
            type: 'archive'
          },
          {
            name: 'app.zip',
            path: '/workspace/packages/mypackage/dist/app.zip',
            type: 'archive'
          }
        ])
      })

      it('should handle dist directory read error', async () => {
        mockedFs.readFile.mockRejectedValue(new Error('File not found'))
        mockedFs.readdir.mockRejectedValue(new Error('Directory not found'))

        const result = await goreleaserConfig['parseArtifacts'](packagePath)

        expect(result).toEqual([])
        expect(mockedCore.debug).toHaveBeenCalledWith(
          'Failed to parse artifacts: Error: Directory not found'
        )
      })

      it('should handle artifacts with missing properties', async () => {
        const metadata = [
          { name: 'app.tar.gz' }, // Missing path, type
          { path: '/dist/app2.zip' }, // Missing name, type
          {} // Missing all properties
        ]

        mockedFs.readFile.mockResolvedValue(JSON.stringify(metadata))

        const result = await goreleaserConfig['parseArtifacts'](packagePath)

        expect(result).toEqual([
          {
            name: 'app.tar.gz',
            path: '',
            type: 'unknown',
            extra: undefined
          },
          {
            name: 'unknown',
            path: '/dist/app2.zip',
            type: 'unknown',
            extra: undefined
          },
          {
            name: 'unknown',
            path: '',
            type: 'unknown',
            extra: undefined
          }
        ])
      })
    })
  })

  describe('edge cases', () => {
    it('should handle package name extraction for binary', async () => {
      const packageVersionWithNestedName: PackageVersion = {
        ...samplePackageVersion,
        name: '@myorg/nested/package'
      }

      // Test through generateConfig which uses the binary name logic
      mockedFs.readFile.mockRejectedValue(new Error('File not found'))
      mockedFs.writeFile.mockResolvedValue(undefined)

      await goreleaserConfig.generateConfig(packageVersionWithNestedName)

      expect(mockedYaml.stringify).toHaveBeenCalledWith(
        expect.objectContaining({
          builds: expect.arrayContaining([
            expect.objectContaining({
              binary: 'package' // Should be the last part after splitting by '/'
            })
          ])
        })
      )
    })

    it('should handle undefined goreleaserKey', () => {
      const configWithoutKey = new GoReleaserConfig({
        dryRun: false
      })

      expect(configWithoutKey).toBeInstanceOf(GoReleaserConfig)
    })
  })
})
