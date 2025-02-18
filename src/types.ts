import { RepositoryTagsResult, RepositoryTagsResultImage } from '@docker/actions-toolkit/lib/types/dockerhub';
import { ProcessedWrapperImageConfigVariant, TagFilter } from './config';

export interface DockerReleaseTagImage {
  digest: string;
  tagName: string;
  mappedTagName: string;
  platform: string;
  architecture: string;
  os: string;
  osVersion?: string;
  osFeatures?: string;
  features?: string;
  variant?: string;
  status: string;
  lastPushed: number;
  _orig: RepositoryTagsResultImage;
}

export interface DockerReleaseTag {
  name: string;
  matchedTagFilter?: TagFilter;
  images: DockerReleaseTagImage[];
  lastPushed: number;
  _orig: RepositoryTagsResult;
}

export type TagNameMapper = (
  tag: RepositoryTagsResult,
  image: RepositoryTagsResultImage,
  config: ProcessedWrapperImageConfigVariant,
) => Promise<string>;

export

interface DockerUpstreamReleasePre {
  digest: string;
  tags: Map<string, string>;
  os: string;
  architecture: string;
  platform: string;
  lastPushed: number;
  releaseTag: DockerReleaseTag;
  releaseTagImage: DockerReleaseTagImage;
}

export interface DockerUpstreamRelease {
  digests: Set<string>;
  tags: Map<string, string>;
  os: string;
  architecture: string;
  platforms: string;
  lastPushed: number;
  releaseTag: DockerReleaseTag;
  releaseTagImage: DockerReleaseTagImage;
  reason?: string;
}

export interface MatrixConfig {
  name: string;
  namespace: string;
  imageName: string;
  fullImageName: string;
  mainTag: string;
  upstream: {
    name: string;
    namespace: string;
    imageName: string;
    tag: string;
  };
  labels: string;
  tags: string;
  upstreamTags: string;
  buildArgs: string;
  buildTarget?: string;
  digests: string;
  platforms: string;
  os: string;
  architecture: string;
  lastPushed: number;
  reason: string;
}
