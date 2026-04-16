import { describe, it, expect } from 'vitest';
import { parseYaml, buildParameters } from '../yaml.js';

describe('parseYaml', () => {
    it('parses top-level key-value pairs', () => {
        const result = parseYaml('name: my_tool\ndescription: A useful tool');
        expect(result.name).toBe('my_tool');
        expect(result.description).toBe('A useful tool');
    });

    it('parses quoted string values (double quotes)', () => {
        const result = parseYaml('title: "Hello World"');
        expect(result.title).toBe('Hello World');
    });

    it('parses quoted string values (single quotes)', () => {
        const result = parseYaml("title: 'Hello World'");
        expect(result.title).toBe('Hello World');
    });

    it('parses nested mapping (2-space indent)', () => {
        const yaml = `parameters:
  type: object
  description: params`;
        const result = parseYaml(yaml);
        expect(result.parameters).toEqual({ type: 'object', description: 'params' });
    });

    it('parses sequence (- item format)', () => {
        const yaml = `required:
  - name
  - description`;
        const result = parseYaml(yaml);
        expect(result.required).toEqual(['name', 'description']);
    });

    it('parses sequence with quoted items', () => {
        const yaml = `tags:
  - "tag1"
  - 'tag2'`;
        const result = parseYaml(yaml);
        expect(result.tags).toEqual(['tag1', 'tag2']);
    });

    it('ignores comment lines', () => {
        const yaml = `# This is a comment
name: tool
# Another comment
description: desc`;
        const result = parseYaml(yaml);
        expect(result.name).toBe('tool');
        expect(result.description).toBe('desc');
    });

    it('ignores blank lines', () => {
        const yaml = `name: tool

description: desc`;
        const result = parseYaml(yaml);
        expect(result.name).toBe('tool');
        expect(result.description).toBe('desc');
    });

    it('returns empty object for empty input', () => {
        expect(parseYaml('')).toEqual({});
    });

    it('returns empty object for whitespace-only input', () => {
        expect(parseYaml('   \n  \n')).toEqual({});
    });

    it('handles key with empty value (next line is same indent or EOF)', () => {
        const yaml = 'name:';
        const result = parseYaml(yaml);
        expect(result.name).toBe('');
    });

    it('parses deeply nested mappings', () => {
        const yaml = `parameters:
  type: object
  properties:
    query:
      type: string
      description: Search query`;
        const result = parseYaml(yaml);
        const params = result.parameters as Record<string, unknown>;
        expect(params.type).toBe('object');
        const props = params.properties as Record<string, unknown>;
        const query = props.query as Record<string, unknown>;
        expect(query.type).toBe('string');
        expect(query.description).toBe('Search query');
    });
});

describe('buildParameters', () => {
    it('builds FunctionDeclaration parameters from a YAML map', () => {
        const raw = parseYaml(`type: object
properties:
  query:
    type: string
    description: The search query
required:
  - query`);
        const result = buildParameters(raw);
        expect(result).toBeDefined();
        expect(result!.type).toBe('object');
        expect(result!.properties.query).toEqual({
            type: 'string',
            description: 'The search query',
        });
        expect(result!.required).toEqual(['query']);
    });

    it('handles enum property', () => {
        const raw = parseYaml(`type: object
properties:
  format:
    type: string
    description: Output format
    enum:
      - json
      - text`);
        const result = buildParameters(raw);
        expect(result!.properties.format.enum).toEqual(['json', 'text']);
    });

    it('handles items (array type) property', () => {
        const raw = parseYaml(`type: object
properties:
  tags:
    type: array
    description: Tag list
    items:
      type: string`);
        const result = buildParameters(raw);
        expect(result!.properties.tags.type).toBe('array');
        expect(result!.properties.tags.items).toEqual({ type: 'string' });
    });

    it('returns undefined for null/undefined input', () => {
        expect(buildParameters(null as never)).toBeUndefined();
        expect(buildParameters(undefined as never)).toBeUndefined();
    });

    it('handles missing required array gracefully', () => {
        const raw = parseYaml(`type: object
properties:
  name:
    type: string
    description: Name`);
        const result = buildParameters(raw);
        expect(result!.required).toBeUndefined();
    });

    it('defaults type to "object" if not specified', () => {
        const raw = parseYaml(`properties:
  name:
    type: string
    description: Name`);
        const result = buildParameters(raw);
        expect(result!.type).toBe('object');
    });

    it('handles empty properties gracefully', () => {
        const raw = parseYaml('type: object');
        const result = buildParameters(raw);
        expect(result!.properties).toEqual({});
    });
});
