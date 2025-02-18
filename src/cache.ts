import { LRUCache } from 'lru-cache';

export class LRUCacheEx<
  K extends {},
  V extends {},
  FC = unknown,
> extends LRUCache<K, V, FC> {
  async computeIfAbsentAsync<VV extends V>(
      k: K,
      supplier: (key: K) => Promise<VV>
  ): Promise<VV> {
    let result = this.get(k);

    if (result !== undefined) {
      return result as VV;
    }

    result = await supplier(k);

    this.set(k, result);

    return result! as VV;
  }
}
