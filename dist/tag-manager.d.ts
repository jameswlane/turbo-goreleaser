import type { Context } from '@actions/github/lib/context';
import type { Octokit, PackageVersion } from './types';
export interface TagManagerConfig {
    octokit: Octokit;
    context: Context;
    tagFormat: 'npm' | 'slash' | 'standard';
    dryRun: boolean;
    workingDirectory: string;
}
export declare class TagManager {
    private octokit;
    private context;
    private tagFormat;
    private dryRun;
    private workingDirectory;
    constructor(config: TagManagerConfig);
    createTag(packageVersion: PackageVersion): Promise<string>;
    createRelease(packageVersion: PackageVersion, changelog: string): Promise<{
        html_url: string;
    } | null>;
    private formatTag;
    private formatReleaseName;
    private tagExists;
    private pushTagWithRetry;
    private isPrerelease;
}
