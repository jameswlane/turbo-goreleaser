import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as yaml from 'yaml'
import type { PackageVersion, GoReleaserArtifact } from './types'

export interface GoReleaserConfigOptions {
  goreleaserKey?: string
  goreleaserVersion?: string
  dryRun: boolean
}

interface GoReleaserYaml {
  project_name?: string
  version?: number
  monorepo?: {
    tag_prefix: string
    dir: string
  }
  builds?: Array<{
    id?: string
    binary?: string
    goos?: string[]
    goarch?: string[]
    main?: string
    dir?: string
    env?: string[]
    flags?: string[]
    ldflags?: string[]
  }>
  archives?: Array<{
    id?: string
    format?: string
    name_template?: string
    files?: string[]
  }>
  release?: {
    github?: {
      owner?: string
      name?: string
    }
    name_template?: string
    draft?: boolean
    prerelease?: string
  }
  changelog?: {
    use?: string
    filters?: {
      exclude?: string[]
    }
  }
}

export class GoReleaserConfig {
  private goreleaserKey?: string
  private dryRun: boolean

  constructor(options: GoReleaserConfigOptions) {
    this.goreleaserKey = options.goreleaserKey
    this.dryRun = options.dryRun
  }

  async isGoReleaserProject(packagePath: string): Promise<boolean> {
    // Check for various indicators that this is a GoReleaser project
    const checks = [
      // Check for .goreleaser.yml or .goreleaser.yaml
      path.join(packagePath, '.goreleaser.yml'),
      path.join(packagePath, '.goreleaser.yaml'),
      // Check for Go files
      path.join(packagePath, 'main.go'),
      path.join(packagePath, 'go.mod'),
      // Check for Rust files (GoReleaser Pro)
      path.join(packagePath, 'Cargo.toml'),
      // Check for other supported languages
      path.join(packagePath, 'package.json'), // Bun/Deno
      path.join(packagePath, 'pyproject.toml'), // Python/UV/Poetry
      path.join(packagePath, 'build.zig') // Zig
    ]

    for (const checkPath of checks) {
      try {
        await fs.access(checkPath)
        core.debug(`Found ${checkPath} - this appears to be a GoReleaser-compatible project`)
        return true
      } catch {
        // File doesn't exist, continue checking
      }
    }

    return false
  }

  async generateConfig(packageVersion: PackageVersion): Promise<string> {
    const configPath = path.join(packageVersion.path, '.goreleaser.yml')

    // Check if config already exists
    let existingConfig: GoReleaserYaml = {}
    try {
      const content = await fs.readFile(configPath, 'utf-8')
      existingConfig = yaml.parse(content) as GoReleaserYaml
    } catch {
      // Config doesn't exist, we'll create one
      core.debug(`No existing GoReleaser config found for ${packageVersion.name}`)
    }

    // Merge with monorepo configuration
    const config: GoReleaserYaml = {
      ...existingConfig,
      project_name: packageVersion.name.replace('@', '').replace(/\//g, '-'),
      version: 2,
      monorepo: {
        tag_prefix: this.getTagPrefix(packageVersion.name),
        dir: packageVersion.path
      },
      ...(!existingConfig.builds && {
        builds: [
          {
            id: 'default',
            binary: packageVersion.name.split('/').pop(),
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
        ]
      }),
      ...(!existingConfig.archives && {
        archives: [
          {
            format: 'tar.gz',
            name_template: '{{ .ProjectName }}_{{ .Version }}_{{ .Os }}_{{ .Arch }}',
            files: ['README*', 'LICENSE*']
          }
        ]
      }),
      release: {
        ...existingConfig.release,
        name_template: `{{ .ProjectName }} {{ .Tag }}`,
        prerelease: 'auto'
      },
      changelog: {
        use: 'github',
        filters: {
          exclude: ['^docs:', '^test:', '^ci:', '^chore:']
        }
      }
    }

    // Write the generated config
    const generatedPath = path.join(packageVersion.path, '.goreleaser.generated.yml')
    await fs.writeFile(generatedPath, yaml.stringify(config), 'utf-8')

    return generatedPath
  }

  async runGoReleaser(
    packageVersion: PackageVersion,
    configPath: string
  ): Promise<GoReleaserArtifact[]> {
    if (this.dryRun) {
      core.info(`[DRY RUN] Would run GoReleaser for ${packageVersion.name}`)
      return []
    }

    try {
      // Install GoReleaser if not present
      await this.installGoReleaser()

      // Set up environment variables
      const env: Record<string, string> = {
        ...process.env,
        GORELEASER_CURRENT_TAG:
          this.getTagPrefix(packageVersion.name) + 'v' + packageVersion.newVersion
      }

      if (this.goreleaserKey) {
        env.GORELEASER_KEY = this.goreleaserKey
      }

      // Run GoReleaser
      const args = ['release', '--clean', '--config', configPath]

      if (this.dryRun) {
        args.push('--skip=publish')
        args.push('--skip=announce')
      }

      const output: string[] = []
      const options: exec.ExecOptions = {
        cwd: packageVersion.path,
        env,
        listeners: {
          stdout: (data: Buffer) => {
            output.push(data.toString())
          }
        }
      }

      const exitCode = await exec.exec('goreleaser', args, options)

      if (exitCode !== 0) {
        throw new Error(`GoReleaser failed with exit code ${exitCode}`)
      }

      // Parse artifacts from output
      const artifacts = await this.parseArtifacts(packageVersion.path)

      core.info(`GoReleaser completed successfully for ${packageVersion.name}`)
      return artifacts
    } catch (error) {
      core.error(`Failed to run GoReleaser for ${packageVersion.name}: ${error}`)
      throw error
    }
  }

  private async installGoReleaser(): Promise<void> {
    // Check if GoReleaser is already installed
    const goreleaserPath = await io.which('goreleaser', false)
    if (goreleaserPath) {
      core.debug('GoReleaser is already installed')
      return
    }

    core.info('Installing GoReleaser...')

    // Install GoReleaser using the official action's approach
    const distribution = this.goreleaserKey ? 'goreleaser-pro' : 'goreleaser'

    try {
      // Download and install GoReleaser
      const downloadUrl = await this.getDownloadUrl(distribution)

      // Use exec to download and extract
      await exec.exec('sh', ['-c', `curl -sfL ${downloadUrl} | sh -s -- -b /usr/local/bin`])

      core.info('GoReleaser installed successfully')
    } catch (error) {
      throw new Error(`Failed to install GoReleaser: ${error}`)
    }
  }

  private async getDownloadUrl(distribution: string): Promise<string> {
    // Construct the download URL based on distribution and version
    if (distribution === 'goreleaser-pro') {
      return 'https://goreleaser.com/pro/install.sh'
    }
    return 'https://install.goreleaser.com/github.com/goreleaser/goreleaser.sh'
  }

  private getTagPrefix(packageName: string): string {
    // Generate tag prefix for monorepo
    const cleanName = packageName.replace('@', '').replace(/\//g, '-')
    return `${cleanName}/`
  }

  private async parseArtifacts(packagePath: string): Promise<GoReleaserArtifact[]> {
    const artifacts: GoReleaserArtifact[] = []

    try {
      // Look for dist directory where GoReleaser outputs artifacts
      const distPath = path.join(packagePath, 'dist')
      const metadataPath = path.join(distPath, 'artifacts.json')

      try {
        const content = await fs.readFile(metadataPath, 'utf-8')
        const metadata = JSON.parse(content)

        if (Array.isArray(metadata)) {
          for (const item of metadata) {
            artifacts.push({
              name: item.name || 'unknown',
              path: item.path || '',
              type: item.type || 'unknown',
              extra: item.extra
            })
          }
        }
      } catch {
        core.debug('No artifacts.json found, checking dist directory')

        // Fallback: list files in dist directory
        const files = await fs.readdir(distPath)
        for (const file of files) {
          if (
            file.endsWith('.tar.gz') ||
            file.endsWith('.zip') ||
            file.endsWith('.deb') ||
            file.endsWith('.rpm')
          ) {
            artifacts.push({
              name: file,
              path: path.join(distPath, file),
              type: 'archive'
            })
          }
        }
      }
    } catch (error) {
      core.debug(`Failed to parse artifacts: ${error}`)
    }

    return artifacts
  }
}
