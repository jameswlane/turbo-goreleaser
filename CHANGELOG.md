## [1.3.2](https://github.com/jameswlane/turbo-goreleaser/compare/v1.3.1...v1.3.2) (2025-09-26)


### Bug Fixes

* let GoReleaser handle releases entirely for GoReleaser projects ([563ae26](https://github.com/jameswlane/turbo-goreleaser/commit/563ae2687204ec57c303027342eca4571b9ba7aa))

## [1.3.1](https://github.com/jameswlane/turbo-goreleaser/compare/v1.3.0...v1.3.1) (2025-09-26)


### Bug Fixes

* ensure git operations use correct working directory in GitHub Actions ([8333c92](https://github.com/jameswlane/turbo-goreleaser/commit/8333c923aca2ec918c0e242570eefe9dd80fd47a))

# [1.3.0](https://github.com/jameswlane/turbo-goreleaser/compare/v1.2.5...v1.3.0) (2025-09-25)


### Features

* log action version on startup for better debugging ([bb43534](https://github.com/jameswlane/turbo-goreleaser/commit/bb4353436a5718a35b82504c8f513ce894ca9d34))

## [1.2.5](https://github.com/jameswlane/turbo-goreleaser/compare/v1.2.4...v1.2.5) (2025-09-25)


### Bug Fixes

* configure git user before creating tags in GitHub Actions ([eb01772](https://github.com/jameswlane/turbo-goreleaser/commit/eb01772174cfdaf5b634ac4c81abb88233d43c82))

## [1.2.4](https://github.com/jameswlane/turbo-goreleaser/compare/v1.2.3...v1.2.4) (2025-09-25)


### Bug Fixes

* update release workflow to include dist files in version tags ([f3b6417](https://github.com/jameswlane/turbo-goreleaser/commit/f3b6417877697428b72a64015ed647955e594bcd))

## [1.2.3](https://github.com/jameswlane/turbo-goreleaser/compare/v1.2.2...v1.2.3) (2025-09-25)


### Bug Fixes

* allow ~ character in git references for HEAD~1 support ([b7c3ad2](https://github.com/jameswlane/turbo-goreleaser/commit/b7c3ad2a1db40e0e2f596d5b955304c1c5fae648))

## [1.2.2](https://github.com/jameswlane/turbo-goreleaser/compare/v1.2.1...v1.2.2) (2025-09-25)


### Bug Fixes

* allow legitimate absolute paths in GitHub Actions environment ([38179cc](https://github.com/jameswlane/turbo-goreleaser/commit/38179cc43241367e897cb04b16ef6425f79439a2))
* update dist files after path validation changes ([f3e97fa](https://github.com/jameswlane/turbo-goreleaser/commit/f3e97fa7bdbc0fd21ed7bbce3fa0f7c0f303bd83))

## [1.2.1](https://github.com/jameswlane/turbo-goreleaser/compare/v1.2.0...v1.2.1) (2025-09-25)


### Bug Fixes

* resolve working directory path relative to GITHUB_WORKSPACE instead of action directory ([e15a746](https://github.com/jameswlane/turbo-goreleaser/commit/e15a74660a4473bf78b9f50772942def28dee569))

# [1.2.0](https://github.com/jameswlane/turbo-goreleaser/compare/v1.1.0...v1.2.0) (2025-09-25)


### Features

* automate major version tag updates with semantic-release ([7b71d89](https://github.com/jameswlane/turbo-goreleaser/commit/7b71d89f903948d6dc6421730999ab48c5473fbc))

# [1.1.0](https://github.com/jameswlane/turbo-goreleaser/compare/v1.0.0...v1.1.0) (2025-09-25)


### Bug Fixes

* specify entry point in ncc build command to ensure proper dist/index.js generation ([ddb77f5](https://github.com/jameswlane/turbo-goreleaser/commit/ddb77f57af3cbf679988f7eef6f28ba4219da1b4))


### Features

* include dist/ directory in repository for GitHub Action ([8f9aab0](https://github.com/jameswlane/turbo-goreleaser/commit/8f9aab055aef4364b789161c11faf10137cc41f4))

# 1.0.0 (2025-09-24)


### Bug Fixes

* add TypeScript build step before packaging in CI ([1255634](https://github.com/jameswlane/turbo-goreleaser/commit/1255634bae7f75c18bdebaaa582c9651e55a5b09))
* address critical Node.js version parsing and Git reference issues ([79ece20](https://github.com/jameswlane/turbo-goreleaser/commit/79ece2063d87f3f017d4f9542959b088b08b696b))
* address critical security vulnerabilities and performance issues ([7efb1ed](https://github.com/jameswlane/turbo-goreleaser/commit/7efb1ed76a107c775ebfbb099d0ccda9add52a31))
* correct environment variable names in action.yml for @actions/core compatibility ([e2a3753](https://github.com/jameswlane/turbo-goreleaser/commit/e2a37531aee5b4027d3f4e7d87e1ea5a548ad4f9))
* correct GitHub token handling and action configuration ([0f66a95](https://github.com/jameswlane/turbo-goreleaser/commit/0f66a959ebd2822f80daa5ea3739dd46c17b35f5))
* enhance security validations and implement parallel processing ([491ae6a](https://github.com/jameswlane/turbo-goreleaser/commit/491ae6aff181f0128ed2206b4b61a4e9b79fe7ff))
* **hooks:** add file existence check in conventional-commit hook ([d42f7f4](https://github.com/jameswlane/turbo-goreleaser/commit/d42f7f4c7a2ff27025379ac447408d77fe202c88))
* make goreleaser-config tests resilient to CI environment variables ([b637c0b](https://github.com/jameswlane/turbo-goreleaser/commit/b637c0bd3c1fb45fc08de3249ea247a082538aff))
* replace turbo-monorepo workflow with proper GitHub Action release workflow ([46b6e03](https://github.com/jameswlane/turbo-goreleaser/commit/46b6e037ddd3167c42fbd0bf168e73ff2841f590))
* resolve merge conflicts and update tests for batch processing ([6cc7e11](https://github.com/jameswlane/turbo-goreleaser/commit/6cc7e11652d608644c7eaaa01881f1d51b78696e))
* update test expectations for security improvements ([c46e60b](https://github.com/jameswlane/turbo-goreleaser/commit/c46e60bd1478ff52c697f5fd96a2a904afcef9aa))
* use pre-built bundle in action execution ([cd02c3d](https://github.com/jameswlane/turbo-goreleaser/commit/cd02c3db230b3c3e0e425e6ed48a8af3b4021cdd))


### Features

* add semantic-release for automated versioning and releases ([af2f407](https://github.com/jameswlane/turbo-goreleaser/commit/af2f407a20a76b368bf2b6303f1798b6f3970722))
* implement comprehensive security and performance improvements ([af9359b](https://github.com/jameswlane/turbo-goreleaser/commit/af9359beb07f87ba6b59a94c5ac08400c9b94930))
* implement turbo-goreleaser GitHub Action ([05eabde](https://github.com/jameswlane/turbo-goreleaser/commit/05eabde64250491f042f57b180bae1ef628f12e4))


### BREAKING CHANGES

* First stable release of turbo-goreleaser action
