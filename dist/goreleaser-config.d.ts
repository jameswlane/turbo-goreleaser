import type { GoReleaserArtifact, PackageVersion } from './types'
export interface GoReleaserConfigOptions {
  goreleaserKey?: string
  goreleaserVersion?: string
  dryRun: boolean
}
export declare class GoReleaserConfig {
  private goreleaserKey?
  private dryRun
  constructor(options: GoReleaserConfigOptions)
  isGoReleaserProject(packagePath: string): Promise<boolean>
  generateConfig(packageVersion: PackageVersion): Promise<string>
  runGoReleaser(packageVersion: PackageVersion, configPath: string): Promise<GoReleaserArtifact[]>
  private runGoReleaserAction
  private getTagPrefix
  private parseArtifacts
  private isValidPath
  private isValidPackagePath
  private isValidTag
}
