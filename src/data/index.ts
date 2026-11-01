// Typed access to the curated JSON (checked by tests/data.test.ts).
import type { GaData, RouteTemplate, Segment } from '../core/data';
import gaJson from './ga.json';
import segmentsJson from './segments.json';
import templatesJson from './templates.json';

export const TEMPLATES = templatesJson.templates as RouteTemplate[];
export const SEGMENTS = segmentsJson.segments as Segment[];
export const GA = gaJson as unknown as GaData;
