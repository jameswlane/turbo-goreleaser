import type { Package, PackageVersion } from './types'
export interface SemanticReleaseConfig {
  enabled: boolean
  types?: Record<string, string>
}
export declare class SemanticReleaseParser {
  private types
  private enabled
  constructor(config: SemanticReleaseConfig)
  analyzeCommits(packages: Package[]): Promise<PackageVersion[]>
  private getCommits
  private filterCommitsForPackage
  private getCommitFilesBatch
  private isPackageScope
  private determineReleaseType
  private isValidVersionUpgrade
}
