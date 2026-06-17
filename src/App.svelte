<script lang="ts">
  import WarehouseScene from './lib/WarehouseScene.svelte';
  import { SEGMENTS_SUNDANCE } from './data/segmentsWarehouse5';
  import type { SegmentType } from './types';

  const ALL_TYPES: SegmentType[] = ['AISLE', 'BAY', 'LEVEL', 'SPACE'];

  const TYPE_COLORS: Record<SegmentType, string> = {
    AISLE: '#3b82f6',
    BAY:   '#f97316',
    LEVEL: '#22c55e',
    SPACE: '#ef4444',
  };

  // Overlays default off — the realistic racks carry the view; chips toggle
  // the schematic tier boxes on top.
  let visibleTypes = new Set<SegmentType>();

  // Demo stock: pallets + box stacks filling the bins, off by default.
  let showStock = false;

  function toggle(type: SegmentType) {
    const next = new Set(visibleTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    visibleTypes = next;
  }

  $: counts = (() => {
    const out: Record<SegmentType, number> = { AISLE: 0, BAY: 0, LEVEL: 0, SPACE: 0 };
    for (const s of SEGMENTS_SUNDANCE) out[s.type]++;
    return out;
  })();
</script>

<main>
  <header>
    <div class="title">
      <h1>Warehouse 3D View</h1>
      <span class="subtitle">
        {counts.AISLE} aisles · {counts.BAY} bays · {counts.LEVEL} levels · {counts.SPACE.toLocaleString()} spaces
      </span>
    </div>
    <div class="filters">
      <span class="filters-label">overlays</span>
      {#each ALL_TYPES as type}
        <button
          class="chip"
          class:active={visibleTypes.has(type)}
          style="--chip-color: {TYPE_COLORS[type]}"
          on:click={() => toggle(type)}
        >
          <span class="dot"></span>{type}
          <span class="count">{counts[type].toLocaleString()}</span>
        </button>
      {/each}
    </div>
    <button
      class="stock-btn"
      class:active={showStock}
      on:click={() => (showStock = !showStock)}
      title="Show demo stock (pallets &amp; boxes) in the bins"
    >
      <span class="stock-dot"></span>Demo stock {showStock ? 'on' : 'off'}
    </button>
  </header>
  <WarehouseScene segments={SEGMENTS_SUNDANCE} {visibleTypes} {showStock} />
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #dde3ea;
  }
  header {
    background: #f4f6f8;
    border-bottom: 1px solid #cbd5e1;
    padding: 10px 18px;
    display: flex;
    align-items: center;
    gap: 24px;
    color: #0f172a;
  }
  .title { display: flex; flex-direction: column; }
  h1 { font-size: 16px; margin: 0; font-weight: 600; letter-spacing: 0.2px; }
  .subtitle { font-size: 11px; opacity: 0.65; font-family: monospace; margin-top: 2px; }
  .filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .filters-label {
    font-size: 9px; font-family: monospace; letter-spacing: 1.2px;
    text-transform: uppercase; color: #64748b;
  }
  .chip {
    background: transparent;
    border: 1.5px solid #cbd5e1;
    color: #475569;
    padding: 4px 10px;
    border-radius: 999px;
    cursor: pointer;
    font-size: 11px;
    font-family: monospace;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s;
  }
  .chip:hover { border-color: var(--chip-color); color: #0f172a; }
  .chip.active { border-color: var(--chip-color); color: var(--chip-color); background: rgba(15,23,42,0.04); }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--chip-color);
  }
  .count { opacity: 0.55; }
  .stock-btn {
    margin-left: auto;
    background: transparent;
    border: 1.5px solid #cbd5e1;
    color: #475569;
    padding: 5px 12px;
    border-radius: 999px;
    cursor: pointer;
    font-size: 11px;
    font-family: monospace;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    transition: all 0.15s;
  }
  .stock-btn:hover { border-color: #c2843a; color: #0f172a; }
  .stock-btn.active {
    border-color: #c2843a; color: #8a5a1e; background: rgba(194,132,58,0.12);
  }
  .stock-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: #c2843a;
  }
</style>
