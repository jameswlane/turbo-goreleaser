import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as yaml from 'yaml'
import type { GoReleaserArtifact, PackageVersion } from './types'

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
    mode?: string
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
      // Set up environment variables
      const tagPrefix = this.getTagPrefix(packageVersion.name)
      const currentTag = tagPrefix + 'v' + packageVersion.newVersion

      // Validate tag for security (prevent injection)
      if (!this.isValidTag(currentTag)) {
        throw new Error(`Invalid tag format: ${currentTag}`)
      }

      // Validate config path for security
      if (!this.isValidPath(configPath)) {
        throw new Error(`Invalid config path: ${configPath}`)
      }

      // Validate package path for security
      if (!this.isValidPackagePath(packageVersion.path)) {
        throw new Error(`Invalid package path: ${packageVersion.path}`)
      }

      // Use the GoReleaser GitHub Action instead of downloading the binary
      await this.runGoReleaserAction(packageVersion, configPath, currentTag)

      // Parse artifacts from output
      const artifacts = await this.parseArtifacts(packageVersion.path)

      core.info(`GoReleaser completed successfully for ${packageVersion.name}`)
      return artifacts
    } catch (error) {
      core.error(`Failed to run GoReleaser for ${packageVersion.name}: ${error}`)
      throw error
    }
  }

  private async runGoReleaserAction(
    packageVersion: PackageVersion,
    configPath: string,
    currentTag: string
  ): Promise<void> {
    core.info(`Running GoReleaser for ${packageVersion.name}`)

    // Set up environment variables
    const env: Record<string, string> = {
      ...process.env,
      GORELEASER_CURRENT_TAG: currentTag,
      GITHUB_TOKEN: process.env['GITHUB_TOKEN'] || ''
    }

    if (this.goreleaserKey) {
      env['GORELEASER_KEY'] = this.goreleaserKey
    }

    // Construct arguments for GoReleaser
    const args = ['release', '--clean', '--config', configPath]

    if (this.dryRun) {
      args.push('--skip=publish', '--skip=announce')
    }
    // In non-dry-run mode, let GoReleaser handle everything (create release and upload assets)

    const execOptions: exec.ExecOptions = {
      cwd: packageVersion.path,
      env
    }

    // GoReleaser is already installed by the goreleaser-action in our composite action
    const exitCode = await exec.exec('goreleaser', args, execOptions)

    if (exitCode !== 0) {
      throw new Error(`GoReleaser failed with exit code ${exitCode}`)
    }
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

  private isValidPath(filePath: string): boolean {
    // Check if path is defined
    if (!filePath || typeof filePath !== 'string') {
      return false
    }

    try {
      // Prevent directory traversal and other unsafe paths
      const normalizedPath = path.normalize(filePath)

      // Check if normalization returned a valid string
      if (!normalizedPath || typeof normalizedPath !== 'string') {
        return false
      }

      // Check for directory traversal attempts
      if (normalizedPath.includes('..')) {
        return false
      }

      // Only allow .yml, .yaml extensions and alphanumeric characters with common safe symbols
      // Allow both relative and absolute paths
      if (!normalizedPath.match(/^\/?(\.\/)?[a-zA-Z0-9._/-]+\.(yml|yaml)$/)) {
        return false
      }

      return true
    } catch (error) {
      // If any error occurs during validation, consider it invalid
      return false
    }
  }

  private isValidPackagePath(packagePath: string): boolean {
    // Check if path is defined
    if (!packagePath || typeof packagePath !== 'string') {
      return false
    }

    try {
      // Prevent directory traversal and other unsafe paths
      const normalizedPath = path.normalize(packagePath)

      // Check if normalization returned a valid string
      if (!normalizedPath || typeof normalizedPath !== 'string') {
        return false
      }

      // Check for directory traversal attempts
      if (normalizedPath.includes('..')) {
        return false
      }

      // Only allow alphanumeric characters, hyphens, underscores, dots, and forward slashes
      // Allow both relative and absolute paths, but with reasonable length
      if (!normalizedPath.match(/^[a-zA-Z0-9._/-]+$/) || normalizedPath.length > 200) {
        return false
      }

      // Additional security: should not contain common dangerous paths
      const dangerousPaths = ['/etc', '/usr/bin', '/bin', '/sbin', '/root', '/home']
      if (dangerousPaths.some(dangerous => normalizedPath.startsWith(dangerous))) {
        return false
      }

      return true
    } catch (error) {
      // If any error occurs during validation, consider it invalid
      return false
    }
  }

  private isValidTag(tag: string): boolean {
    // Check if tag is defined
    if (!tag || typeof tag !== 'string') {
      return false
    }

    // Tag should only contain alphanumeric characters, hyphens, underscores, dots, slashes, and 'v'
    // No spaces, quotes, or other shell metacharacters
    if (!tag.match(/^[a-zA-Z0-9._/v-]+$/)) {
      return false
    }

    // Reasonable length limit
    if (tag.length > 100) {
      return false
    }

    return true
  }
}
