<script setup lang="ts">
import { computed } from "vue"
import type { MarketFlowEdge } from "@otbor/contract"
import { VisSankey, VisSingleContainer } from "@unovis/vue"
import { ChartContainer, type ChartConfig } from "@/shared/ui"
import { workFormatText } from "@/shared/lib"
import { WORK_FORMAT_LABELS, seniorityLabel } from "./tip"

const props = defineProps<{ edges: ReadonlyArray<MarketFlowEdge> }>()
const config: ChartConfig = { flow: { label: "Поток", color: "var(--chart-1)" } }

const formatLabel = (key: string): string => WORK_FORMAT_LABELS[key] ?? workFormatText(key)

const graph = computed(() => {
  const ids = new Map<string, number>()
  const nodes: Array<{ id: string; label: string }> = []
  const node = (id: string, label: string): number => {
    const existing = ids.get(id)
    if (existing !== undefined) return existing
    ids.set(id, nodes.length)
    nodes.push({ id, label })
    return nodes.length - 1
  }
  const links = props.edges.map((edge) => ({
    source: node(`s:${edge.from}`, seniorityLabel(edge.from)),
    target: node(`f:${edge.to}`, formatLabel(edge.to)),
    value: edge.count
  }))
  return { nodes, links }
})
</script>

<template>
  <ChartContainer :config="config" class="aspect-auto h-72">
    <VisSingleContainer :data="graph" :height="288">
      <VisSankey
        :label="(node: { label: string }) => node.label"
        :node-width="14"
        :node-padding="10"
        :link-color="'var(--chart-1)'"
        :node-color="'var(--chart-2)'"
        :sub-label="''"
      />
    </VisSingleContainer>
  </ChartContainer>
</template>
