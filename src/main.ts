import * as core from '@actions/core';
import * as path from 'node:path';
import * as actionsToolkit from '@docker/actions-toolkit';
import { createHash } from 'node:crypto';
import { Toolkit } from '@docker/actions-toolkit/lib/toolkit';
import { getContext, getInputs, type Inputs } from './context';
import { parseConfig, processConfig } from './config';
import {
  executeExpression,
  filterTags,
  getRepositoryAllTagsMax,
  mergeSameTags,
} from './tags';
import { getImageLabel } from './image';
import * as l from './labels';
import { DockerHub } from '@docker/actions-toolkit/lib/dockerhub';
import { DockerUpstreamRelease, MatrixConfig } from './types';
import * as util from 'node:util';
import { revParse } from './git';

export async function run(): Promise<void> {
  await actionsToolkit.run(
    // main
    async () => {
      const inputs: Inputs = getInputs();
      const toolkit = new Toolkit({ githubToken: inputs.githubToken });
      const context = await getContext(inputs.context, toolkit);

      await core.group(`Context info`, async () => {
        core.info(`eventName: ${context.eventName}`);
        core.info(`sha: ${context.sha}`);
        core.info(`ref: ${context.ref}`);
        core.info(`workflow: ${context.workflow}`);
        core.info(`action: ${context.action}`);
        core.info(`actor: ${context.actor}`);
        core.info(`runNumber: ${context.runNumber}`);
        core.info(`runId: ${context.runId}`);
        core.info(`commitDate: ${context.commitDate}`);
      });

      if (core.isDebug()) {
        await core.group(`Webhook payload`, async () => {
          core.info(JSON.stringify(context.payload, null, 2));
        });
      }

      const dockerHub = await DockerHub.build({
        credentials: {
          username: inputs.dockerHub.username,
          password: inputs.dockerHub.password,
        },
      });

      core.startGroup(`Parsing "${inputs.config}" config file`);
      const config = processConfig(parseConfig(inputs.config));
      core.info(`Config: ${JSON.stringify(config, null, 2)}`);
      core.endGroup();

      const buildMatrices: MatrixConfig[] = [];
      for (const variant of config.variants) {
        core.info(`Processing variant "${variant.imageName}"`);

        core.startGroup('Calculating build hash');

        const configFolder = path.dirname(inputs.config);

        if (configFolder === '.' && inputs.revProvider === 'config') {
          core.warning(
            `Config folder is same folder as git repository. Using git revision as build hash instead`,
          );
          inputs.revProvider = 'git';
        }

        let buildHash: string = context.sha;
        if (inputs.revProvider === 'config') {
          const folderHash = await revParse(configFolder);
          if (folderHash === false) {
            throw new Error('Failed to get git revision from config folder');
          }

          const dependencies = variant.include ?? [];
          if (dependencies.length === 0) {
            buildHash = folderHash;
          } else {
            const depHashes = [];
            for (const dep of dependencies) {
              const depHash = await revParse(path.join(configFolder, dep));
              if (depHash === false) {
                core.warning(
                  `Failed to get git revision from dependency folder "${dep}" using folder name as hash`,
                );
                depHashes.push(dep);
              } else {
                depHashes.push(depHash);
              }
            }
            buildHash = createHash('sha256')
              .update([folderHash, ...depHashes].join(''))
              .digest('hex');
          }

          core.info(
            `Using config folder "${configFolder}" hash: ${buildHash} with dependencies: ${JSON.stringify(dependencies)}`,
          );
        } else {
          core.info(`Using git revision as build hash ${buildHash}`);
        }

        core.endGroup();

        core.startGroup(
          `Loading Docker image "${variant.upstream.imageName}" tags`,
        );

        const tagsResult = await getRepositoryAllTagsMax(dockerHub, {
          namespace: variant.upstream.namespace,
          name: variant.upstream.name,
          page_size: 100,
          pageLimit: variant.filters?.pageLimit,
        });

        const tags = tagsResult.results ?? [];

        core.info(`Loaded ${tags.length} tags`);
        core.endGroup();

        core.startGroup('Filtering Docker image tags');
        const processedTags = await filterTags(tags, variant);
        core.info(
          `Tags: ${JSON.stringify([...new Set(processedTags.map((t) => t.name))])}`,
        );
        core.info(`${processedTags.length} left after filtering`);

        const mergedTags = mergeSameTags(processedTags);

        core.info(`Total ${mergedTags.length} unique image builds found`);

        core.endGroup();

        const label = (name: string) => `${inputs.labelPrefix}${name}`;
        const [platform] = variant.platforms;

        const releasesToBuild: DockerUpstreamRelease[] = [];
        for (const release of mergedTags) {
          const [[upstreamTag, ourTag]] = release.tags.entries();

          const imageName = `${variant.imageName}:${ourTag}`;
          const imgRev = await getImageLabel(
            imageName,
            platform,
            label(l.imageRevision),
          );
          if (imgRev === false) {
            core.info(
              `Docker image "${imageName}" not found. Adding to build list`,
            );

            releasesToBuild.push({
              ...release,
              reason: 'Image not found',
            });
            continue;
          }

          if (imgRev == null) {
            core.info(
              `Docker image "${imageName}" revision label not found. Adding to build list`,
            );

            releasesToBuild.push({
              ...release,
              reason: 'Revision label not found',
            });
            continue;
          }

          const imageUpstreamDigests = (await getImageLabel(
            imageName,
            platform,
            label(l.upstreamDigests),
          )) as string | undefined;
          if (imageUpstreamDigests == null) {
            core.info(
              `Docker image "${imageName}" source image digest label not found. Adding to build list`,
            );

            releasesToBuild.push({
              ...release,
              reason: 'Digest label not found',
            });
            continue;
          }

          if (
            [...release.digests].sort().join(',') !==
            imageUpstreamDigests.split(',').sort().join(',')
          ) {
            core.info(
              `Docker image "${imageName}" source image digests "${imageUpstreamDigests}" does not match expected upstream digest "${[...release.digests.values()]}". Adding to build list`,
            );

            releasesToBuild.push({
              ...release,
              reason: 'Upstream image changed',
            });
            continue;
          }

          const imageLabel = await getImageLabel(
            imageName,
            platform,
            label(l.upstreamImage),
          );
          if (imageLabel == null) {
            core.info(
              `Docker image "${imageName}" source image label not found. Adding to build list`,
            );

            releasesToBuild.push({
              ...release,
              reason: 'Image label not found',
            });
            continue;
          }

          if (imageLabel !== variant.upstream.imageName) {
            core.info(
              `Docker image "${imageName}" source image "${imageLabel}" does not match expected upstream image "${variant.upstream.imageName}". Adding to build list`,
            );

            releasesToBuild.push({
              ...release,
              reason: 'Upstream Image mismatch',
            });
            continue;
          }

          const imageUpstreamTag = await getImageLabel(
            imageName,
            platform,
            label(l.upstreamTag),
          );
          if (imageUpstreamTag == null) {
            core.info(
              `Docker image "${imageName}" source image tag label not found. Adding to build list`,
            );

            releasesToBuild.push({
              ...release,
              reason: 'Tag label not found',
            });
            continue;
          }

          if (imageUpstreamTag !== upstreamTag) {
            core.info(
              `Docker image "${imageName}" source image tag "${imageUpstreamTag}" does not match expected upstream tag "${upstreamTag}". Adding to build list`,
            );

            releasesToBuild.push({
              ...release,
              reason: 'Tag mismatch',
            });
            continue;
          }

          const imageUpstreamPlatform = (await getImageLabel(
            imageName,
            platform,
            label(l.upstreamPlatforms),
          )) as string | undefined;
          if (
            imageUpstreamPlatform == null ||
            imageUpstreamPlatform.trim().length === 0
          ) {
            core.info(
              `Docker image "${imageName}" source image platform label not found. Adding to build list`,
            );

            releasesToBuild.push({
              ...release,
              reason: 'Platform label not found',
            });
            continue;
          }

          const imageUpstreamPlatforms = imageUpstreamPlatform
            .split(',')
            .sort()
            .join(',');

          if (imageUpstreamPlatforms !== release.platforms) {
            core.info(
              `Docker image "${imageName}" source image platforms "${imageUpstreamPlatform}" does not match expected platforms "${release.platforms}". Adding to build list`,
            );

            releasesToBuild.push({
              ...release,
              reason: 'Platform mismatch',
            });
            continue;
          }

          if (imgRev !== buildHash) {
            core.info(
              `Docker image "${imageName}" is outdated "${imgRev}" current git revision "${buildHash}". Adding to build list`,
            );

            releasesToBuild.push({
              ...release,
              reason: 'Source changed',
            });
            continue;
          }

          if (inputs.force) {
            core.info(
              `Docker image "${imageName}" is up to date. Adding to build list due to force flag`,
            );
            releasesToBuild.push({
              ...release,
              reason: 'Forced',
            });

            continue;
          }

          core.info(
            `Docker image "${imageName}" is up to date. Skipping build`,
          );
        }

      core.startGroup('Building matrix');
      const buildMatrix: MatrixConfig[] = [];
      for (const release of releasesToBuild) {
        const [upstreamTag] = release.tags.keys();

        const imageTags = new Set(release.tags.values());
        const upstreamTags = [...new Set(release.tags.keys())].join(',');

        let extraTags = variant.extraTags;
        let extraBuildArgs = variant.buildArgs;
        let extraLabels = variant.labels;
        let buildTarget = variant.buildTarget ?? undefined;
        if (
          release.releaseTag.matchedTagFilter != null &&
          typeof release.releaseTag.matchedTagFilter === 'object'
        ) {
          if ('extraTags' in release.releaseTag.matchedTagFilter) {
            extraTags = [
              ...extraTags,
              ...(release.releaseTag.matchedTagFilter['extraTags'] ?? []),
            ];
          }

          if ('extraBuildArgs' in release.releaseTag.matchedTagFilter) {
            extraBuildArgs = {
              ...extraBuildArgs,
              ...(release.releaseTag.matchedTagFilter['extraBuildArgs'] ?? {}),
            };
          }

          if ('extraLabels' in release.releaseTag.matchedTagFilter) {
            extraLabels = {
              ...extraLabels,
              ...(release.releaseTag.matchedTagFilter['extraLabels'] ?? {}),
            };
          }

          if ('buildTarget' in release.releaseTag.matchedTagFilter) {
            buildTarget =
              release.releaseTag.matchedTagFilter['buildTarget'] ?? buildTarget;
          }
        }

        for (const tag of extraTags) {
          if (typeof tag === 'string') {
            imageTags.add(tag);
          } else if ('expression' in tag) {
            const exp = await executeExpression(tag.expression)(
              release.releaseTag._orig,
              release.releaseTagImage._orig,
              variant,
            );

            if (exp === null || exp.trim() === '') {
              core.warning(`Expression "${tag.expression}" is empty. Skipping`);
              continue;
            }

            imageTags.add(exp);
          }
        }

        const labels: Record<string, string> = {};
        for (const [name, value] of Object.entries(extraLabels)) {
          if (typeof value === 'string') {
            labels[name] = value;
          } else if ('expression' in value) {
            const exp = await executeExpression(value.expression)(
              release.releaseTag._orig,
              release.releaseTagImage._orig,
              variant,
            );

            if (exp === null || exp.trim() === '') {
              core.warning(
                `Expression "${value.expression}" is empty. Skipping`,
              );
              continue;
            }

            labels[name] = exp;
          }
        }

        const buildArgs: Record<string, string> = {};
        for (const [name, value] of Object.entries(extraBuildArgs)) {
          if (typeof value === 'string') {
            buildArgs[name] = value;
          } else if ('expression' in value) {
            const exp = await executeExpression(value.expression)(
              release.releaseTag._orig,
              release.releaseTagImage._orig,
              variant,
            );

            if (exp === null || exp.trim() === '') {
              core.warning(
                `Expression "${value.expression}" is empty. Skipping`,
              );
              continue;
            }

            buildArgs[name] = exp;
          }
        }
        const digests = [...release.digests].sort().join(',');
        const [mainTag] = [...imageTags.values()];
        const matrix: MatrixConfig = {
          name: variant.name,
          namespace: variant.namespace,
          imageName: variant.imageName,
          fullImageName: `${variant.imageName}:${mainTag}`,
          mainTag,
          upstream: {
            name: variant.upstream.name,
            namespace: variant.upstream.namespace,
            imageName: `${variant.upstream.imageName}:${upstreamTag}`,
            tag: upstreamTag,
          },
          labels: Object.entries({
            [label(l.upstreamImage)]: variant.upstream.imageName,
            [label(l.upstreamTag)]: upstreamTag,
            [label(l.upstreamPlatforms)]: release.platforms,
            [label(l.upstreamDigests)]: digests,
            [label(l.imageRevision)]: buildHash,
            ...labels,
          })
            .map(([k, v]) => `${k}=${v}`)
            .join(inputs.sepLabels),
          tags: [...imageTags.values()].join(inputs.sepTags),
          upstreamTags: upstreamTags,
          buildArgs: Object.entries({
            UPTRACK_SOURCE: `${variant.upstream.imageName}:${upstreamTag}`,
            UPTRACK_IMAGE: variant.upstream.imageName,
            UPTRACK_TAG: upstreamTag,
            UPTRACK_PLATFORMS: release.platforms,
            UPTRACK_DIGESTS: digests,
            UPTRACK_OS: release.os,
            UPTRACK_ARCH: release.architecture,
            UPTRACK_LAST_PUSHED: release.lastPushed,
            UPTRACK_REVISION: buildHash,
            ...buildArgs,
          })
            .map(([k, v]) => `${k}=${v}`)
            .join(inputs.sepBuildArgs),
          buildTarget: buildTarget ?? '',
          digests: digests,
          platforms: release.platforms,
          os: release.os,
          architecture: release.architecture,
          lastPushed: release.lastPushed,
          reason: release.reason ?? 'unknown',
        };

        buildMatrix.push(matrix);
      }

      console.dir(buildMatrix, { depth: null });

      core.endGroup();

      await core.group('Build Summary', async () => {
        const sum = core.summary.addHeading(`Docker UpTrack Summary for Variant "${variant.imageName}"`);

        sum
          .addRaw('<p>')
          .addRaw(
            `This action analyzes Docker images to determine which ones need to be rebuilt.`,
          )
          .addList([
            `Current git revision: <code>${buildHash}</code>`,
            `Image name: <code>${variant.imageName}</code>`,
            `Upstream image name: <code>${variant.upstream.imageName}</code>`,
            `Event: <code>${context.eventName}</code>`,
            `Workflow: <code>${context.workflow}</code>`,
            `Run ID: <code>${context.runId}</code>`,
          ])
          .addRaw('</p>');

        sum
          .addRaw(
            `<details><summary><strong>📋 Configuration File</strong></summary>`,
          )
          .addCodeBlock(JSON.stringify(config, null, 2), 'json')
          .addRaw(`</details>`);

        if (buildMatrix.length === 0) {
          await core.summary
            .addHeading('No Images to Build', 2)
            .addRaw('✅ All images are up to date. No builds required.')
            .write();
          return;
        }

        sum.addHeading('🏷 Tag Mappings Matrix', 3);

        sum.addTable([
          [
            { data: 'Image', header: true },
            { data: 'Upstream Tag', header: true },
            { data: 'Mapped Tags', header: true },
            { data: 'Platforms', header: true },
            { data: 'Target', header: true },
            { data: 'Build Args', header: true },
            { data: 'Labels', header: true },
            { data: 'Reason', header: true },
          ],
          ...buildMatrix.map((matrix) => [
            `<pre language="bash"><code>${matrix.tags
              .split(inputs.sepTags)
              .map((t) => `docker pull ${matrix.imageName}:${t}`)
              .join('\n')}</code></pre>`,
            `<pre><code>${matrix.upstream.tag}</code></pre>`,
            `<pre><code>${matrix.tags.split(',').join('\n')}</code></pre>`,
            `<pre><code>${matrix.platforms.split(',').join('\n')}</code></pre>`,
            `<pre><code>${matrix.buildTarget}</code></pre>`,
            `<pre><code>${matrix.buildArgs
              .split(inputs.sepBuildArgs)
              .map((v) => `<code>${v}</code>`)
              .join('\n')}</code></pre>`,
            `<pre><code>${matrix.labels
              .split(inputs.sepLabels)
              .map((v) => `<code>${v}</code>`)
              .join('\n')}</code></pre>`,
            matrix.reason,
          ]),
        ]);

        sum.addHeading(
          `🚀 Build Matrix (${buildMatrix.length} images to build)`,
          3,
        );
        sum.addList([
          `Total upstream tags processed: <strong>${tags.length}</strong>`,
          `Filtered tags remaining: <strong>${processedTags.length}</strong>`,
          `Unique builds required: <strong>${buildMatrix.length}</strong>`,
          `Image name: <strong>${variant.imageName}</strong>`,
          `Label prefix: <strong>${inputs.labelPrefix}</strong>`,
        ]);

        sum.addSeparator();

        sum
          .addRaw(
            `<details><summary><strong>📁 Matrix Output</strong></summary>`,
          )
          .addCodeBlock(
            util.inspect(buildMatrix, { depth: null, colors: false }),
            'js',
          )
          .addRaw(`</details>`);

        await sum.write();
      });

        buildMatrices.push(...buildMatrix);
      }

      core.setOutput('matrix', JSON.stringify(buildMatrices));
    },
  );
}
