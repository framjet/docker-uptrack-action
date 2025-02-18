import { Exec } from '@docker/actions-toolkit/lib/exec';

export async function revParse(path: string): Promise<string | false> {
  return await Exec.getExecOutput(
    'git',
    [
      'rev-parse',
      `HEAD:${path}`
    ],
    {
      ignoreReturnCode: true,
      silent: true,
    },
  ).then((res) => {
    if (res.stderr.length > 0 && res.exitCode != 0) {
      if (res.stderr.includes('does not exist')) {
        return false;
      }

      throw new Error(res.stderr.trim());
    }

    return res.stdout.trim();
  })
}
