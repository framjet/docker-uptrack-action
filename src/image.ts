import { Exec } from '@docker/actions-toolkit/lib/exec';
import { LRUCacheEx } from './cache';

const cache = new LRUCacheEx({
  max: 100,
});

export async function getImageLabels(
  imageName: string,
  platform: string
): Promise<Record<string, string> | false> {
  return cache.computeIfAbsentAsync(
    `labels[${imageName}:${platform}]`,
    async () =>
      Exec.getExecOutput(
        'regctl',
        [
          'image',
          'config',
          imageName,
          '-p',
          platform,
          '--format',
          `'{{ json .Config.Labels }}'`,
        ],
        {
          ignoreReturnCode: true,
          silent: true,
        },
      ).then((res) => {
        if (res.stderr.length > 0 && res.exitCode != 0) {
          if (res.stderr.includes('not found')) {
            return false;
          }

          throw new Error(res.stderr.trim());
        }

        if (res.stdout === "''") {
          return false;
        }

        return JSON.parse(res.stdout.slice(1, -1)) as Record<string, string>;
      }),
  );
}

export async function getImageLabel(
  imageName: string,
  platform: string,
  name: string,
  defaultValue?: string,
): Promise<string | false> {
  const labels = await getImageLabels(imageName, platform);

  if (labels === false) {
    return false;
  }

  return labels[name] ?? defaultValue;
}
