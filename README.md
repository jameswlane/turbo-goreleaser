# Turbo GoReleaser

[![CI](https://github.com/jameswlane/turbo-goreleaser/actions/workflows/ci.yml/badge.svg)](https://github.com/jameswlane/turbo-goreleaser/actions/workflows/ci.yml)
[![GitHub Super-Linter](https://github.com/jameswlane/turbo-goreleaser/actions/workflows/linter.yml/badge.svg)](https://github.com/jameswlane/turbo-goreleaser/actions/workflows/linter.yml)

Multi-component release automation for TurboRepo with GoReleaser Pro. This GitHub Action bridges the gap between TurboRepo's monorepo management and GoReleaser's powerful release capabilities.

## Features

- 🚀 **Automated Multi-Component Releases**: Release multiple packages and apps from a single monorepo
- 🎯 **Smart Change Detection**: Uses Turbo's dependency graph to detect and release only changed packages
- 📝 **Semantic Versioning**: Automatic version bumping based on conventional commits
- 📄 **Changelog Generation**: Per-package changelogs with aggregated release notes
- 🏷️ **Flexible Tag Formats**: Support for NPM-style, slash-separated, or standard tags
- 📦 **GoReleaser Integration**: Seamless integration with GoReleaser and GoReleaser Pro
- 🌐 **Multi-Language Support**: Go, Bun, Rust, Zig, Deno, Python, UV, and Poetry builders

## Quick Start

### Basic Usage

```yaml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Full history for change detection

      - uses: jameswlane/turbo-goreleaser@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Advanced Configuration

```yaml
- uses: jameswlane/turbo-goreleaser@v1
  with:
    # GitHub token for API operations (required)
    github-token: ${{ secrets.GITHUB_TOKEN }}

    # GoReleaser Pro license key (optional)
    goreleaser-key: ${{ secrets.GORELEASER_KEY }}

    # GoReleaser version to use (optional)
    goreleaser-version: '~> v2'

    # Turbo remote cache token (optional)
    turbo-token: ${{ secrets.TURBO_TOKEN }}

    # Turbo team identifier (optional)
    turbo-team: ${{ vars.TURBO_TEAM }}

    # Components to release: all, apps, or packages
    release-type: 'all'

    # Tag format: npm, slash, or standard
    tag-format: 'slash'

    # Run without creating actual releases
    dry-run: 'false'

    # Use conventional commits for versioning
    conventional-commits: 'true'

    # Working directory for the action
    working-directory: '.'
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token for API operations | Yes | `${{ github.token }}` |
| `goreleaser-key` | GoReleaser Pro license key | No | - |
| `goreleaser-version` | GoReleaser version to use | No | `~> v2` |
| `turbo-token` | Turbo remote cache token | No | - |
| `turbo-team` | Turbo team identifier | No | - |
| `release-type` | Components to release (`all`, `apps`, `packages`) | No | `all` |
| `tag-format` | Tag format (`npm`, `slash`, `standard`) | No | `slash` |
| `dry-run` | Run without creating actual releases | No | `false` |
| `conventional-commits` | Use conventional commits for versioning | No | `true` |
| `working-directory` | Working directory for the action | No | `.` |

## Outputs

| Output | Description |
|--------|-------------|
| `released-packages` | JSON array of released packages with their versions |
| `release-notes` | Aggregated release notes for all packages |
| `tags-created` | List of Git tags created during the release |
| `goreleaser-artifacts` | JSON metadata of GoReleaser build artifacts |

## Tag Formats

The action supports three tag formats:

### NPM Style (`npm`)
```
@scope/package@v1.0.0
package@v1.0.0
```

### Slash Style (`slash`) - Recommended for monorepos
```
package-name/v1.0.0
scope-package/v1.0.0
```

### Standard (`standard`) - For single packages
```
v1.0.0
```

## Monorepo Structure

The action expects a standard TurboRepo structure:

```
├── apps/
│   ├── web/              # Next.js app
│   └── api/              # Go API server
├── packages/
│   ├── ui/               # React component library
│   └── utils/            # Shared utilities
├── turbo.json           # Turbo configuration
└── package.json         # Root package.json
```

## Conventional Commits

When `conventional-commits` is enabled, the action uses commit messages to determine version bumps:

- `feat:` - Minor version bump
- `fix:` - Patch version bump
- `BREAKING CHANGE:` - Major version bump
- Scoped commits: `feat(api):` - Only affects the `api` package

## GoReleaser Integration

### Automatic Configuration

The action automatically generates GoReleaser configurations for monorepo packages:

```yaml
# Generated .goreleaser.yml
project_name: my-package
version: 2

monorepo:
  tag_prefix: my-package/
  dir: packages/my-package

builds:
  - id: default
    binary: my-package
    goos: [linux, darwin, windows]
    goarch: [amd64, arm64]
```

### Custom Configuration

If a `.goreleaser.yml` exists in your package directory, the action will use it and only add the necessary monorepo configuration.

## Examples

### Release Only Changed Apps

```yaml
- uses: jameswlane/turbo-goreleaser@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    release-type: 'apps'
```

### Dry Run Mode

```yaml
- uses: jameswlane/turbo-goreleaser@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    dry-run: 'true'
```

### With GoReleaser Pro

```yaml
- uses: jameswlane/turbo-goreleaser@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    goreleaser-key: ${{ secrets.GORELEASER_KEY }}
```

### NPM-Style Tags

```yaml
- uses: jameswlane/turbo-goreleaser@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    tag-format: 'npm'
```

## Workflow Example

Complete workflow with caching and optimizations:

```yaml
name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      packages: write
      id-token: write  # For signing with cosign
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Setup Turbo
        run: npm install -g turbo

      - name: Run tests
        run: turbo run test

      - name: Run Turbo GoReleaser
        uses: jameswlane/turbo-goreleaser@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          goreleaser-key: ${{ secrets.GORELEASER_KEY }}
          turbo-token: ${{ secrets.TURBO_TOKEN }}
          turbo-team: ${{ vars.TURBO_TEAM }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: release-artifacts
          path: |*
            */dist/
            */.goreleaser.generated.yml
```

## Supported Languages

Through GoReleaser and GoReleaser Pro, the action supports:

- **Go** - Native support
- **Rust** - Via GoReleaser Pro
- **Bun** - Via GoReleaser Pro
- **Deno** - Via GoReleaser Pro
- **Zig** - Via GoReleaser Pro
- **Python** - Via GoReleaser Pro (UV, Poetry)

## Troubleshooting

### No packages detected

Ensure your repository has a `turbo.json` file and packages follow the standard structure.

### Tags already exist

The action will skip packages that already have tags for the calculated version.

### GoReleaser fails

Check that your package has the necessary files (e.g., `go.mod`, `Cargo.toml`) for the detected language.

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT - See [LICENSE](LICENSE) for details.

## Credits

Built with ❤️ by [James W Lane](https://github.com/jameswlane)

Inspired by:
- [Turborepo](https://turbo.build/repo)
- [GoReleaser](https://goreleaser.com)
- [Semantic Release](https://semantic-release.gitbook.io/)
