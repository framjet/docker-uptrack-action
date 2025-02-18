import { jexl } from './jexl';

import {
  RepositoryTagsRequest,
  RepositoryTagsResponse,
  RepositoryTagsResult,
  RepositoryTagsResultImage,
} from '@docker/actions-toolkit/lib/types/dockerhub';
import { ProcessedWrapperImageConfigVariant, TagFilter } from './config';
import {
  DockerReleaseTag,
  DockerReleaseTagImage,
  DockerUpstreamRelease,
  DockerUpstreamReleasePre,
  TagNameMapper,
} from './types';
import { DockerHub } from '@docker/actions-toolkit/lib/dockerhub';
import { LRUCacheEx } from './cache';

export interface RepositoryTagsRequestMax extends RepositoryTagsRequest {
  pageLimit?: number;
}

const cache = new LRUCacheEx({
  max: 100,
});

export async function getRepositoryAllTagsMax(
  hub: DockerHub,
  req: RepositoryTagsRequestMax,
): Promise<RepositoryTagsResponse> {
  return cache.computeIfAbsentAsync(JSON.stringify(req), async () => {
    const tags: RepositoryTagsResponse = await hub.getRepositoryTags(req);
    let page = 0;
    const pageLimit = req.pageLimit ?? 0;
    while (tags.next && (pageLimit === 0 || page < pageLimit)) {
      const nextURL = new URL(tags.next);
      const pageNumber = Number(nextURL.searchParams.get('page'));
      const pageSize =
        Number(nextURL.searchParams.get('page_size')) || undefined;
      const nextTags = await hub.getRepositoryTags({
        namespace: req.namespace,
        name: req.name,
        page: pageNumber,
        page_size: pageSize || req.page_size,
      } as RepositoryTagsRequest);
      tags.results.push(...nextTags.results);
      tags.next = nextTags.next;
      page++;
    }
    return tags;
  });
}

export async function filterTags(
  tags: RepositoryTagsResult[],
  config: ProcessedWrapperImageConfigVariant,
): Promise<DockerReleaseTag[]> {
  const filters = config.filters;
  const result: DockerReleaseTag[] = [];
  let oldestTimestamp: number | undefined = undefined;
  if (filters.oldest_tag_limit != null) {
    oldestTimestamp = Math.round(
      new Date().getTime() / 1000 - filters.oldest_tag_limit,
    );
  }

  let matchAllNames = false;
  if (filters.tags.length === 0) {
    matchAllNames = true;
  }

  for (const tag of tags) {
    if (tag.tag_status !== 'active' || tag.content_type !== 'image') {
      continue;
    }

    if (
      filters.limit_releases != null &&
      result.length >= filters.limit_releases
    ) {
      break;
    }

    const tagLastPushed = Math.round(
      new Date(tag.tag_last_pushed).getTime() / 1000,
    );
    if (oldestTimestamp != null) {
      if (tagLastPushed < oldestTimestamp) {
        continue;
      }

      let old = false;
      for (const img of tag.images) {
        if (!filters.platforms.has(`${img.os}/${img.architecture}`)) {
          continue;
        }

        const imgLastPushed = Math.round(
          new Date(img.last_pushed).getTime() / 1000,
        );
        if (imgLastPushed < oldestTimestamp) {
          old = true;
        }
      }

      if (old) {
        continue;
      }
    }

    const tagName = tag.name;
    if (tagName == null || tagName.trim().length === 0) {
      continue;
    }

    let mappedValue: TagNameMapper = async () => tagName;

    let foundTagFilter: TagFilter | undefined = undefined;
    if (!matchAllNames) {
      let found = false;
      for (const tagNameFilter of filters.tags) {
        if (typeof tagNameFilter === 'string') {
          if (tagNameFilter !== tagName) {
            continue;
          }

          found = true;
          foundTagFilter = tagNameFilter;
          break;
        }

        if ('name' in tagNameFilter) {
          if (tagNameFilter.name !== tagName) {
            continue;
          }

          if ('mapped' in tagNameFilter) {
            mappedValue = async () => tagNameFilter.mapped;
          } else if ('expression' in tagNameFilter) {
            mappedValue = executeExpression(tagNameFilter.expression);
          } else {
            mappedValue = async () => tagNameFilter.name;
          }

          found = true;
          foundTagFilter = tagNameFilter;
          break;
        }

        if ('pattern' in tagNameFilter) {
          const regXp = new RegExp(tagNameFilter.pattern, 'g');
          if (!tagName.match(regXp)) {
            continue;
          }

          if ('mapped' in tagNameFilter) {
            mappedValue = async () =>
              tagName.replace(regXp, tagNameFilter.mapped);
          } else if ('expression' in tagNameFilter) {
            mappedValue = executeExpression(tagNameFilter.expression);
          }

          found = true;
          foundTagFilter = tagNameFilter;
          break;
        }
      }

      if (!found) {
        continue;
      }
    }

    const images: DockerReleaseTagImage[] = [];
    for (const i of tag.images ?? []) {
      const platform = `${i.os}/${i.architecture}`;
      if (!filters.platforms.has(platform)) {
        continue;
      }

      images.push({
        digest: i.digest,
        tagName: tagName,
        mappedTagName: await mappedValue(tag, i, config),
        architecture: i.architecture,
        features: i.features,
        lastPushed: Math.round(new Date(i.last_pushed).getTime() / 1000),
        os: i.os,
        osFeatures: i.os_features,
        osVersion: i.os_version,
        platform,
        status: i.status,
        variant: i.variant,
        _orig: i,
      });
    }

    result.push({
      name: tagName,
      lastPushed: tagLastPushed,
      matchedTagFilter: foundTagFilter,
      images,
      _orig: tag,
    });
  }

  return result;
}

export function executeExpression(expression: string): TagNameMapper {
  if (expression == null || expression.trim().length === 0) {
    throw new Error('Expression cannot be empty or null');
  }

  return async (
    tag: RepositoryTagsResult,
    image: RepositoryTagsResultImage,
    config: ProcessedWrapperImageConfigVariant,
  ) =>
    jexl
      .eval(expression, {
        name: tag.name,
        os: image.os,
        architecture: image.architecture,
        platform: `${image.os}/${image.architecture}`,
        tag,
        image,
        config,
      })
      .then(
        (res: unknown) => {
          if (res == null) {
            throw new Error(`Expression (${expression}) returned null`);
          }

          if (typeof res !== 'string') {
            throw new Error(
              `Expression (${expression}) returned value of type "${typeof res}" instead of "string"`,
            );
          }

          if (res.trim().length === 0) {
            throw new Error(`Expression (${expression}) returned empty value`);
          }

          return res;
        },
        (reason: unknown) => {
          throw new Error(
            `Error occurred while evaluating expression (${expression}): ${reason}`,
          );
        },
      );
}

export function mergeSameTags(
  tags: DockerReleaseTag[],
): DockerUpstreamRelease[] {
  const digestToTag = new Map<string, DockerUpstreamReleasePre>();

  for (const tag of tags) {
    for (const img of tag.images) {
      const release = digestToTag.get(img.digest) ?? {
        digest: img.digest,
        platform: img.platform,
        architecture: img.architecture,
        os: img.os,
        lastPushed: img.lastPushed,
        tags: new Map(),
        releaseTag: tag,
        releaseTagImage: img,
      };

      release.tags.set(img.tagName, img.mappedTagName);
      digestToTag.set(img.digest, release);
    }
  }

  const byPlatform = new Map<string, Map<string, DockerUpstreamReleasePre>>();
  for (const release of digestToTag.values()) {
    const platform =
      byPlatform.get(release.platform) ??
      new Map<string, DockerUpstreamReleasePre>();
    const tags = [...release.tags.keys()].sort().join(',');

    if (platform.has(tags)) {
      throw new Error(
        `Duplicate tags for platform ${release.platform}: ${tags}`,
      );
    }

    platform.set(tags, release);

    byPlatform.set(release.platform, platform);
  }

  const result: DockerUpstreamRelease[] = [];
  const platforms = [...byPlatform.keys()].sort();
  const [platform] = platforms;
  const platformReleases = byPlatform.get(platform);

  if (platformReleases == null) {
    throw new Error(`No releases for platform ${platform}`);
  }

  for (const [tags, release] of platformReleases.entries()) {
    const digests = new Set<string>();
    const releasePlatforms = new Set<string>();
    for (const p of platforms) {
      const pReleases = byPlatform.get(p);
      if (pReleases == null) {
        throw new Error(`No releases for platform ${p}`);
      }

      const pRelease = pReleases.get(tags);
      if (pRelease == null) {
        throw new Error(`No release for platform ${p} with tags ${tags}`);
      }

      digests.add(pRelease.digest);
      releasePlatforms.add(pRelease.platform);
    }

    result.push({
      digests,
      tags: release.tags,
      os: release.os,
      architecture: release.architecture,
      platforms: [...releasePlatforms].sort().join(','),
      lastPushed: release.lastPushed,
      releaseTag: release.releaseTag,
      releaseTagImage: release.releaseTagImage,
    });
  }

  return result;
}
