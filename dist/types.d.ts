import type { GitHub } from '@actions/github/lib/utils'
export interface ActionInputs {
  githubToken: string
  goreleaserKey?: string
  goreleaserVersion?: string
  turboToken?: string
  turboTeam?: string
  releaseType: 'all' | 'apps' | 'packages'
  tagFormat: 'npm' | 'slash' | 'standard'
  dryRun: boolean
  conventionalCommits: boolean
  workingDirectory: string
}
export interface Package {
  name: string
  path: string
  version: string
  private?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
export interface PackageVersion extends Package {
  currentVersion: string
  newVersion: string
  releaseType: 'major' | 'minor' | 'patch'
  commits: Commit[]
}
export interface Commit {
  sha: string
  message: string
  type?: string
  scope?: string
  breaking?: boolean
}
export interface ReleaseResult {
  package: string
  version: string
  tag: string
  releaseUrl: string
}
export interface GoReleaserArtifact {
  name: string
  path: string
  type: string
  extra?: Record<string, unknown>
}
export type Octokit = InstanceType<typeof GitHub>
