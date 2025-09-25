import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import type { Package } from './types'
import { createSafeExecOptions, sanitizeGitRef, sanitizePath } from './validation'

export interface TurboIntegrationConfig {
  workingDirectory: string
}

interface TurboPackageInfo {
  name: string
  path: string
  type: 'app' | 'package'
}

interface PackageJson {
  name?: string
  version?: string
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  workspaces?: string[] | { packages: string[] }
}

export class TurboIntegration {
  private workingDirectory: string

  constructor(config: TurboIntegrationConfig) {
    this.workingDirectory = config.workingDirectory
  }

  async getChangedPackages(releaseType: 'all' | 'apps' | 'packages'): Promise<Package[]> {
    // First, get all packages in the monorepo
    const allPackages = await this.getAllPackages()

    // Then, filter by release type
    const filteredPackages = this.filterPackagesByType(allPackages, releaseType)

    // Finally, detect which ones have changes
    const changedPackages = await this.detectChangedPackages(filteredPackages)

    return changedPackages
  }

  private async getAllPackages(): Promise<TurboPackageInfo[]> {
    const packages: TurboPackageInfo[] = []

    try {
      // Check for turbo.json to ensure we're in a Turbo monorepo
      const turboConfigPath = path.resolve(this.workingDirectory, 'turbo.json')
      await fs.access(turboConfigPath)

      // Look for packages in common monorepo locations
      const possibleLocations = ['apps', 'packages', 'services', 'libs']

      // Process locations in parallel for better performance
      const locationPromises = possibleLocations.map(async location => {
        const dirPath = path.resolve(this.workingDirectory, location)
        const locationPackages: TurboPackageInfo[] = []

        try {
          const stat = await fs.stat(dirPath)
          if (stat.isDirectory()) {
            const entries = await fs.readdir(dirPath, { withFileTypes: true })

            // Process directory entries in parallel
            const entryPromises = entries
              .filter(entry => entry.isDirectory())
              .map(async entry => {
                const packageJsonPath = sanitizePath(
                  path.join(dirPath, entry.name, 'package.json'),
                  this.workingDirectory
                )

                try {
                  const packageJson = await this.readPackageJson(packageJsonPath)
                  if (packageJson.name) {
                    return {
                      name: packageJson.name,
                      path: path.join(location, entry.name),
                      type: location === 'apps' ? 'app' : 'package'
                    } as TurboPackageInfo
                  }
                } catch {
                  // Skip if no package.json
                  core.debug(`No package.json found in ${packageJsonPath}`)
                }
                return null
              })

            const results = await Promise.all(entryPromises)
            locationPackages.push(...results.filter((pkg): pkg is TurboPackageInfo => pkg !== null))
          }
        } catch {
          // Directory doesn't exist, skip
          core.debug(`Directory ${dirPath} not found`)
        }

        return locationPackages
      })

      const allLocationResults = await Promise.all(locationPromises)
      for (const locationPackages of allLocationResults) {
        packages.push(...locationPackages)
      }

      // Also check workspace configuration in root package.json
      const rootPackageJsonPath = path.join(this.workingDirectory, 'package.json')
      try {
        const rootPackageJson = await this.readPackageJson(rootPackageJsonPath)
        if (rootPackageJson.workspaces) {
          // Parse workspace patterns if needed
          core.debug(`Found workspace configuration: ${JSON.stringify(rootPackageJson.workspaces)}`)
        }
      } catch {
        core.debug('No root package.json found')
      }
    } catch (error) {
      core.warning(`Failed to get packages: ${error}`)
    }

    return packages
  }

  private filterPackagesByType(
    packages: TurboPackageInfo[],
    releaseType: 'all' | 'apps' | 'packages'
  ): TurboPackageInfo[] {
    if (releaseType === 'all') {
      return packages
    }

    return packages.filter(pkg => {
      if (releaseType === 'apps') {
        return pkg.type === 'app'
      } else {
        return pkg.type === 'package'
      }
    })
  }

  private async detectChangedPackages(packages: TurboPackageInfo[]): Promise<Package[]> {
    const changedPackages: Package[] = []

    try {
      // Use turbo to detect affected packages with safe execution
      const args = ['run', 'build', '--affected', '--dry-run=json']

      let output = ''
      const options: exec.ExecOptions = {
        ...createSafeExecOptions(this.workingDirectory),
        listeners: {
          stdout: (data: Buffer) => {
            output += data.toString()
          }
        },
        silent: true
      }

      try {
        await exec.exec('turbo', args, options)
      } catch (error) {
        // Turbo might exit with non-zero if there are no tasks to run
        core.debug(`Turbo dry-run completed with: ${error}`)
      }

      // Parse Turbo output
      if (output) {
        try {
          const dryRunResult = JSON.parse(output)
          const affectedPackages = new Set<string>()

          if (dryRunResult.tasks) {
            for (const task of dryRunResult.tasks) {
              if (task.package) {
                affectedPackages.add(task.package)
              }
            }
          }

          // Map affected packages to our package list
          for (const pkg of packages) {
            if (affectedPackages.has(pkg.name)) {
              const packageJsonPath = sanitizePath(
                path.join(this.workingDirectory, pkg.path, 'package.json'),
                this.workingDirectory
              )
              const packageJson = await this.readPackageJson(packageJsonPath)

              changedPackages.push({
                name: pkg.name,
                path: pkg.path,
                version: packageJson.version || '0.0.0',
                private: packageJson.private,
                dependencies: packageJson.dependencies,
                devDependencies: packageJson.devDependencies
              })
            }
          }
        } catch (parseError) {
          core.warning(`Failed to parse Turbo output: ${parseError}`)
          return this.fallbackToGitDetection(packages, 'Failed to parse Turbo output')
        }
      } else {
        return this.fallbackToGitDetection(packages, 'Turbo provided no output')
      }
    } catch (error) {
      core.warning(`Failed to detect changes with Turbo: ${error}`)
      return this.fallbackToGitDetection(packages, 'Turbo command failed')
    }

    return changedPackages
  }

  private async fallbackToGitDetection(
    packages: TurboPackageInfo[],
    reason: string
  ): Promise<Package[]> {
    core.info(`Falling back to git-based detection: ${reason}`)
    return this.detectChangedPackagesViaGit(packages)
  }

  private async detectChangedPackagesViaGit(packages: TurboPackageInfo[]): Promise<Package[]> {
    const changedPackages: Package[] = []

    try {
      // Get the base ref for comparison with validation
      let baseRef = process.env['GITHUB_BASE_REF'] || 'HEAD~1'

      // Validate that the base ref exists, fallback to root commit for single-commit repos
      try {
        await exec.getExecOutput(
          'git',
          ['rev-parse', '--verify', `${baseRef}^{commit}`],
          createSafeExecOptions(this.workingDirectory)
        )
      } catch {
        // If HEAD~1 doesn't exist (single commit repo), use empty tree hash
        core.debug(`Base ref ${baseRef} not found, using empty tree for comparison`)
        baseRef = '4b825dc642cb6eb9a060e54bf8d69288fbee4904' // Git's empty tree hash
      }

      baseRef = sanitizeGitRef(baseRef)

      // Get list of changed files using git diff --name-status for more info
      const { stdout } = await exec.getExecOutput(
        'git',
        ['diff', '--name-status', baseRef],
        createSafeExecOptions(this.workingDirectory)
      )

      const changedFiles = stdout
        .trim()
        .split('\n')
        .filter(f => f)
        .map(line => {
          // Extract filename from status output (format: "M\tfilename")
          const parts = line.split('\t')
          return parts.length > 1 ? parts[1] : ''
        })
        .filter(f => f)

      for (const pkg of packages) {
        // Check if any changed file is in this package's directory
        const hasChanges = changedFiles.some(file => file.startsWith(`${pkg.path}/`))

        if (hasChanges) {
          const packageJsonPath = path.join(this.workingDirectory, pkg.path, 'package.json')
          const packageJson = await this.readPackageJson(packageJsonPath)

          changedPackages.push({
            name: pkg.name,
            path: pkg.path,
            version: packageJson.version || '0.0.0',
            private: packageJson.private,
            dependencies: packageJson.dependencies,
            devDependencies: packageJson.devDependencies
          })
        }
      }
    } catch (error) {
      core.warning(`Failed to detect changes via Git: ${error}`)
    }

    return changedPackages
  }

  private async readPackageJson(packageJsonPath: string): Promise<PackageJson> {
    try {
      // Validate path is safe before reading
      const safePath = sanitizePath(packageJsonPath, this.workingDirectory)
      const content = await fs.readFile(safePath, 'utf-8')
      return JSON.parse(content) as PackageJson
    } catch (error) {
      throw new Error(`Failed to read package.json at ${packageJsonPath}: ${error}`)
    }
  }
}
