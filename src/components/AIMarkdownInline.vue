<script setup lang="ts">
import type { MarkdownInlineSegment } from '@/services/markdownRenderer';

defineProps<{
  segments: MarkdownInlineSegment[];
}>();
</script>

<template>
  <template v-for="(segment, segmentIndex) in segments" :key="segmentIndex">
    <code v-if="segment.type === 'code'" class="ai-inline-code">
      {{ segment.content }}
    </code>
    <strong v-else-if="segment.type === 'strong'" class="ai-inline-strong">
      {{ segment.content }}
    </strong>
    <em v-else-if="segment.type === 'emphasis'" class="ai-inline-emphasis">
      {{ segment.content }}
    </em>
    <a
      v-else-if="segment.type === 'link'"
      class="ai-inline-link"
      :href="segment.href"
      rel="noreferrer"
      target="_blank"
    >
      {{ segment.content }}
    </a>
    <span v-else>{{ segment.content }}</span>
  </template>
</template>
