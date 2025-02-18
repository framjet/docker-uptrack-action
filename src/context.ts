import * as core from '@actions/core';
import { Context as GithubContext } from '@actions/github/lib/context';
import { Git } from '@docker/actions-toolkit/lib/git';
import { GitHub } from '@docker/actions-toolkit/lib/github';
import { Toolkit } from '@docker/actions-toolkit/lib/toolkit';

export const ContextSource = {
  workflow: 'workflow',
  git: 'git',
} as const;

export type ContextSource = (typeof ContextSource)[keyof typeof ContextSource];

export interface Context extends GithubContext {
  commitDate: Date;
}

export interface Inputs {
  context: ContextSource;
  config: string;
  revProvider: string;
  force: boolean;
  dockerHub: {
    username: string;
    password: string;
  };
  labelPrefix: string;
  sepTags: string;
  sepLabels: string;
  sepBuildArgs: string;
  githubToken: string;
}

export function getInputs(): Inputs {
  return {
    context: (core.getInput('context') ||
      ContextSource.workflow) as ContextSource,
    config: core.getInput('config') || './uptrack.json',
    revProvider: core.getInput('rev-provider') || 'git',
    force: core.getBooleanInput('force'),
    dockerHub: {
      username: core.getInput('username'),
      password: core.getInput('password'),
    },
    labelPrefix: core.getInput('label-prefix') || `com.framjet.uptrack.`,
    sepTags: core.getInput('sep-tags', { trimWhitespace: false }) || `\n`,
    sepLabels: core.getInput('sep-labels', { trimWhitespace: false }) || `\n`,
    sepBuildArgs:
      core.getInput('sep-build-args', { trimWhitespace: false }) || `\n`,
    githubToken: core.getInput('github-token'),
  };
}

export async function getContext(
  source: ContextSource,
  toolkit: Toolkit,
): Promise<Context> {
  switch (source) {
    case ContextSource.workflow:
      return await getContextFromWorkflow(toolkit);
    case ContextSource.git:
      return await getContextFromGit();
    default:
      throw new Error(`Invalid context source: ${source}`);
  }
}

async function getContextFromWorkflow(toolkit: Toolkit): Promise<Context> {
  const context = GitHub.context;

  // Needs to override Git reference with pr ref instead of upstream branch ref
  // for pull_request_target event
  // https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#pull_request_target
  if (/pull_request_target/.test(context.eventName)) {
    context.ref = `refs/pull/${context.payload.number}/merge`;
  }

  // DOCKER_METADATA_PR_HEAD_SHA env var can be used to set associated head
  // SHA instead of commit SHA that triggered the workflow on pull request
  // event.
  if (/true/i.test(process.env.DOCKER_METADATA_PR_HEAD_SHA || '')) {
    if (
      (/pull_request/.test(context.eventName) ||
        /pull_request_target/.test(context.eventName)) &&
      context.payload?.pull_request?.head?.sha != undefined
    ) {
      context.sha = context.payload.pull_request.head.sha;
    }
  }

  return {
    commitDate: await getCommitDateFromWorkflow(context.sha, toolkit),
    ...context,
  } as Context;
}

async function getContextFromGit(): Promise<Context> {
  const ctx = await Git.context();

  return {
    commitDate: await Git.commitDate(ctx.sha),
    ...ctx,
  } as Context;
}

async function getCommitDateFromWorkflow(
  sha: string,
  toolkit: Toolkit,
): Promise<Date> {
  const event = GitHub.context.payload as unknown as {
    // branch push
    commits?: Array<{
      timestamp: string;
      // commit sha
      id: string;
    }>;
    // tags
    head_commit?: {
      timestamp: string;
      // commit sha
      id: string;
    };
  };

  if (event.commits) {
    const commitDate = event.commits.find((x) => x.id === sha)?.timestamp;
    if (commitDate) {
      return new Date(commitDate);
    }
  }

  if (event.head_commit) {
    if (event.head_commit.id === sha) {
      return new Date(event.head_commit.timestamp);
    }
  }

  // fallback to github api for commit date
  try {
    const commit = await toolkit.github.octokit.rest.repos.getCommit({
      owner: GitHub.context.repo.owner,
      repo: GitHub.context.repo.repo,
      ref: sha,
    });
    if (commit.data.commit.committer?.date) {
      return new Date(commit.data.commit.committer.date);
    }

    // noinspection ExceptionCaughtLocallyJS
    throw new Error('Committer date not found');
  } catch (error) {
    if (error instanceof Error) {
      core.debug(`Failed to get commit date from GitHub API: ${error.message}`);
    } else {
      core.debug(`Failed to get commit date from GitHub API: ${error}`);
    }
    return new Date();
  }
}
