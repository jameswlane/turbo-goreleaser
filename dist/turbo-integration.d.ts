import type { Package } from './types';
export interface TurboIntegrationConfig {
    workingDirectory: string;
}
export declare class TurboIntegration {
    private workingDirectory;
    constructor(config: TurboIntegrationConfig);
    getChangedPackages(releaseType: 'all' | 'apps' | 'packages'): Promise<Package[]>;
    private getAllPackages;
    private filterPackagesByType;
    private detectChangedPackages;
    private fallbackToGitDetection;
    private detectChangedPackagesViaGit;
    private readPackageJson;
}
