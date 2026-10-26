import broadcast from '../../fixtures/templates/broadcast.json';
import minimal from '../../fixtures/templates/minimal.json';
import climb from '../../fixtures/templates/climb.json';
import chrono from '../../fixtures/templates/chrono.json';
import strip from '../../fixtures/templates/strip.json';
import story from '../../fixtures/templates/story.json';
import type { TemplateV1 } from '@override-studio/shared';

/** Built-in catalog. Fase 6+ adds generated ones. */
export const BUILTIN_TEMPLATES: TemplateV1[] = [
  broadcast as TemplateV1,
  minimal as TemplateV1,
  climb as TemplateV1,
  chrono as TemplateV1,
  strip as TemplateV1,
  story as TemplateV1,
];
