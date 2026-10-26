import broadcast from '../../fixtures/templates/broadcast.json';
import minimal from '../../fixtures/templates/minimal.json';
import climb from '../../fixtures/templates/climb.json';
import chrono from '../../fixtures/templates/chrono.json';
import strip from '../../fixtures/templates/strip.json';
import story from '../../fixtures/templates/story.json';
import apex from '../../fixtures/templates/apex.json';
import pulse from '../../fixtures/templates/pulse.json';
import type { Template } from '@override-studio/shared';

/** Built-in catalog. Fase 6+ adds generated ones. */
export const BUILTIN_TEMPLATES: Template[] = [
  broadcast as Template,
  minimal as Template,
  climb as Template,
  chrono as Template,
  strip as Template,
  story as Template,
  apex as Template,
  pulse as Template,
];
