/** Binary min-heap of integer items keyed by numeric priority (typed-array backed). */
export class MinHeap {
  private items: Int32Array;
  private prio: Float64Array;
  private n = 0;

  constructor(capacity = 1024) {
    this.items = new Int32Array(capacity);
    this.prio = new Float64Array(capacity);
  }

  get size() {
    return this.n;
  }

  push(item: number, priority: number) {
    if (this.n === this.items.length) {
      const it = new Int32Array(this.n * 2);
      it.set(this.items);
      const pr = new Float64Array(this.n * 2);
      pr.set(this.prio);
      this.items = it;
      this.prio = pr;
    }
    const items = this.items;
    const prio = this.prio;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (prio[p] <= priority) break;
      items[i] = items[p];
      prio[i] = prio[p];
      i = p;
    }
    items[i] = item;
    prio[i] = priority;
  }

  pop(): number | undefined {
    if (!this.n) return undefined;
    const items = this.items;
    const prio = this.prio;
    const top = items[0];
    const n = --this.n;
    if (n > 0) {
      const it = items[n];
      const pr = prio[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && prio[r] < prio[l] ? r : l;
        if (prio[c] >= pr) break;
        items[i] = items[c];
        prio[i] = prio[c];
        i = c;
      }
      items[i] = it;
      prio[i] = pr;
    }
    return top;
  }
}
