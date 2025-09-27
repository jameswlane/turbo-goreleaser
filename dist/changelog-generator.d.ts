import type { Context } from '@actions/github/lib/context';
import type { Commit, Octokit, PackageVersion } from './types';
export interface ChangelogGeneratorConfig {
    octokit: Octokit;
    context: Context;
}
interface GroupedCommits {
    breaking: Commit[];
    features: Commit[];
    fixes: Commit[];
    other: Commit[];
}
export declare class ChangelogGenerator {
    private octokit;
    private context;
    constructor(config: ChangelogGeneratorConfig);
    generate(packageVersions: PackageVersion[]): Promise<Map<string, string>>;
    generatePackageChangelog(packageVersion: PackageVersion): Promise<string>;
    groupCommits(commits: Commit[]): GroupedCommits;
    formatCommit(commit: Commit): string;
    generateComparisonLink(currentVersion: string, newVersion: string, packageVersion: PackageVersion): string;
    getTagName(packageName: string, version: string): string;
    getContributors(commits: Commit[]): Promise<string[]>;
}
export {};
