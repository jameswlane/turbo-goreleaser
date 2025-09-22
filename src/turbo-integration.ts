import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Package } from './types'

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
      const turboConfigPath = path.join(this.workingDirectory, 'turbo.json')
      await fs.access(turboConfigPath)

      // Look for packages in common monorepo locations
      const possibleLocations = ['apps', 'packages', 'services', 'libs']

      for (const location of possibleLocations) {
        const dirPath = path.join(this.workingDirectory, location)

        try {
          const stat = await fs.stat(dirPath)
          if (stat.isDirectory()) {
            const entries = await fs.readdir(dirPath, { withFileTypes: true })

            for (const entry of entries) {
              if (entry.isDirectory()) {
                const packageJsonPath = path.join(dirPath, entry.name, 'package.json')

                try {
                  const packageJson = await this.readPackageJson(packageJsonPath)
                  if (packageJson.name) {
                    packages.push({
                      name: packageJson.name,
                      path: path.join(location, entry.name),
                      type: location === 'apps' ? 'app' : 'package'
                    })
                  }
                } catch {
                  // Skip if no package.json
                  core.debug(`No package.json found in ${packageJsonPath}`)
                }
              }
            }
          }
        } catch {
          // Directory doesn't exist, skip
          core.debug(`Directory ${dirPath} not found`)
        }
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
      // Use turbo to detect affected packages
      const args = ['run', 'build', '--affected', '--dry-run=json']

      let output = ''
      const options: exec.ExecOptions = {
        cwd: this.workingDirectory,
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
        } catch (parseError) {
          core.warning(`Failed to parse Turbo output: ${parseError}`)
          // Fall back to git-based detection
          return this.detectChangedPackagesViaGit(packages)
        }
      } else {
        // Fall back to git-based detection if turbo doesn't provide output
        return this.detectChangedPackagesViaGit(packages)
      }
    } catch (error) {
      core.warning(`Failed to detect changes with Turbo: ${error}`)
      // Fall back to git-based detection
      return this.detectChangedPackagesViaGit(packages)
    }

    return changedPackages
  }

  private async detectChangedPackagesViaGit(packages: TurboPackageInfo[]): Promise<Package[]> {
    const changedPackages: Package[] = []

    try {
      // Get the base ref for comparison
      const baseRef = process.env.GITHUB_BASE_REF || 'HEAD~1'

      // Get list of changed files
      const { stdout } = await exec.getExecOutput('git', ['diff', '--name-only', baseRef], {
        cwd: this.workingDirectory
      })

      const changedFiles = stdout
        .trim()
        .split('\n')
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
      const content = await fs.readFile(packageJsonPath, 'utf-8')
      return JSON.parse(content) as PackageJson
    } catch (error) {
      throw new Error(`Failed to read package.json at ${packageJsonPath}: ${error}`)
    }
  }
}
