// Typed access to the curated JSON (checked by tests/data.test.ts).
import type { GaData, RouteTemplate } from '../core/data';
import gaJson from './ga.json' with { type: 'json' };
import templatesJson from './templates.json' with { type: 'json' };

export const TEMPLATES = templatesJson.templates as RouteTemplate[];
export const GA = gaJson as unknown as GaData;
