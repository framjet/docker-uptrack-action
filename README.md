# FramJet UpTrack Action

[![GitHub release](https://img.shields.io/github/release/framjet/docker-uptrack-action.svg)](https://github.com/framjet/docker-uptrack-action/releases)
[![License](https://img.shields.io/github/license/framjet/docker-uptrack-action.svg)](LICENSE)

A GitHub Action that helps track and automate builds of Docker images that wrap official images. This action monitors
upstream Docker images for new releases and generates a build matrix for creating corresponding wrapper images.

## Features

- 🔄 Tracks upstream Docker image tags
- 🏷️ Supports complex tag filtering and mapping
- 📅 Time-based filtering of releases
- 🔢 Limit number of releases to process
- 🏗️ Multi-platform image support
- 🏷️ Flexible tag generation with expressions
- 🔍 Intelligent build detection to avoid unnecessary rebuilds
- 🔀 Multiple variants support for tracking different upstream images

## Prerequisites

This action requires `regctl` to be available on the runner. You can either:

- Use the [`iarekylew00t/regctl-installer@v3`](https://github.com/marketplace/actions/regctl-installer) action to
  install it (recommended)
- Ensure `regctl` is already installed on your runner

## Usage

### Basic Example

```yaml
name: Build Docker Images

on:
  schedule:
    - cron: '0 */6 * * *'  # Run every 6 hours
  workflow_dispatch:  # Allow manual trigger

jobs:
  track:
    runs-on: ubuntu-latest
    outputs:
      matrix: ${{ steps.track.outputs.matrix }}

    steps:
      - uses: actions/checkout@v4

      - name: Install regctl
        uses: iarekylew00t/regctl-installer@v3

      - name: Track upstream images
        id: track
        uses: framjet/docker-uptrack-action@v1
        with:
          config: ./uptrack.json
          username: ${{ secrets.DOCKERHUB_USERNAME }}
          password: ${{ secrets.DOCKERHUB_TOKEN }}

  build:
    needs: track
    if: needs.track.outputs.matrix != '[]'
    strategy:
      matrix:
        include: ${{ fromJson(needs.track.outputs.matrix) }}
    runs-on: ubuntu-latest

    steps:
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          platforms: ${{ matrix.platform }}
          tags: ${{ matrix.tags }}
          build-args: ${{ matrix.buildArgs }}
          labels: ${{ matrix.labels }}
```

### Configuration File (uptrack.json)

```json
{
  "variants": [
    {
      "namespace": "framjet",
      "name": "nginx",
      "platforms": [
        "linux/amd64",
        "linux/arm64"
      ],
      "upstream": {
        "name": "nginx"
      },
      "filters": {
        "oldest_tag_limit": "1year",
        "limit_releases": 10,
        "tags": [
          {
            "pattern": "(.*)-alpine$",
            "mapped": "$1",
            "extraTags": [
              {
                "expression": "'build-' + now()|formatDateTime('yyyy-MM-dd')"
              }
            ]
          }
        ]
      }
    },
    {
      "namespace": "framjet",
      "name": "nginx",
      "platforms": [
        "linux/amd64"
      ],
      "upstream": {
        "name": "nginx"
      },
      "filters": {
        "limit_releases": 5,
        "tags": [
          {
            "pattern": "(.*)-slim",
            "mapped": "$1",
          }
        ]
      }
    }
  ]
}
```

## Inputs

| Name             | Description                                                                                                          | Required | Default                             |
|------------------|----------------------------------------------------------------------------------------------------------------------|----------|-------------------------------------|
| `config`         | Path to the configuration file                                                                                       | Yes      | `./uptrack.json`                    |
| `rev-provider`   | Revision provider.<br>`git` uses git commit hash<br>`config` uses hash of config folder + `config.include` file list | No       | `git`                               |
| `force`          | Force build even if no changes                                                                                       | No       | `false`                             |
| `username`       | DockerHub username                                                                                                   | Yes      | `${{ secrets.DOCKERHUB_USERNAME }}` |
| `password`       | DockerHub password/token                                                                                             | Yes      | `${{ secrets.DOCKERHUB_TOKEN }}`    |
| `label-prefix`   | Prefix for generated labels                                                                                          | No       | `org.framjet.uptrack.`              |
| `sep-tags`       | Separator for tags output                                                                                            | No       | `\n`                                |
| `sep-labels`     | Separator for labels output                                                                                          | No       | `\n`                                |
| `sep-build-args` | Separator for build args output                                                                                      | No       | `\n`                                |
| `github-token`   | GitHub token for API access                                                                                          | Yes      | `${{ github.token }}`               |

## Outputs

### `matrix`

A JSON array containing build information for each image that needs to be built. Each object in the array includes:

- `platform`: Target platform (e.g., "linux/amd64")
- `tags`: List of tags to apply
- `buildArgs`: Build arguments
- `labels`: Docker image labels
- Additional metadata about the upstream image

The matrix output merges all variants into a single result, making it easy to use in a GitHub Actions matrix strategy.

## Configuration

### Variant Configuration

Each variant in the `variants` array supports the following properties:

- `namespace`: The Docker Hub namespace for the image
- `name`: The name of the image to build
- `platforms`: Array of target platforms
- `upstream`: Configuration for the upstream image to track
- `filters`: Tag filters and limits
- `buildArgs`: Custom build arguments
- `labels`: Custom Docker image labels
- `extraTags`: Additional tags to apply
- `include`: Files/folders to include in the revision hash (when using `rev-provider: config`)
- `buildTarget`: Specific build target to use

### Tag Filters

The action supports several types of tag filters:

1. **Simple string match**
   ```json
   "tags": ["latest", "1.0.0"]
   ```

2. **Pattern matching with mapping**
   ```json
   {
     "pattern": "(\\d+\\.\\d+\\.\\d+)-alpine$",
     "mapped": "$1-custom"
   }
   ```

3. **Expression-based tags**
   ```json
   {
     "pattern": ".*",
     "expression": "tag.name + '-' + platform|replace('/', '-')"
   }
   ```

### Expression Language

The action uses a powerful expression language (JEXL) that supports:

- String operations
- Date/time formatting
- Mathematical operations
- Conditional logic
- Built-in functions

Example expressions:

```
'v' + tag.name|upper
now()|formatDateTime('yyyy-MM-dd')
platform|replace('/', '-')
```

## Examples

### Multiple Variants Example

```json
{
  "variants": [
    {
      "namespace": "myorg",
      "name": "python",
      "platforms": ["linux/amd64", "linux/arm64"],
      "upstream": {
        "name": "python"
      },
      "filters": {
        "tags": [
          {
            "pattern": "(\\d+\\.\\d+)-alpine",
            "mapped": "$1"
          }
        ]
      }
    },
    {
      "namespace": "myorg",
      "name": "nginx",
      "platforms": ["linux/amd64"],
      "upstream": {
        "name": "nginx"
      },
      "filters": {
        "tags": ["stable", "latest"]
      },
      "labels": {
        "org.opencontainers.image.title": "Custom Nginx Image"
      }
    }
  ]
}
```

### Adding Custom Labels

```json
{
  "variants": [
    {
      "namespace": "myorg",
      "name": "python",
      "platforms": [
        "linux/amd64"
      ],
      "upstream": {
        "name": "python"
      },
      "labels": {
        "org.opencontainers.image.title": "Custom Python Image",
        "org.opencontainers.image.version": {
          "expression": "tag.name"
        }
      },
      "filters": {
        "tags": [
          "3.10",
          "3.11"
        ]
      }
    }
  ]
}
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
