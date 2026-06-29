import { describe, expect, it } from 'vitest';
import {
    AVAILABLE_MODEL_ALIASES,
    MODEL_ALIASES,
    isSelectableModelAlias,
    isSupportedModelName,
    listGatewayModels,
    resolveModelAlias,
} from '../model-registry.js';

describe('model registry', () => {
    it('resolves user-facing aliases to provider ids', () => {
        expect(resolveModelAlias('deepseek')).toBe('deepseek-chat');
        expect(resolveModelAlias('deepseek-reasoner')).toBe('deepseek-reasoner');
        expect(resolveModelAlias('custom-model')).toBe('custom-model');
        expect(MODEL_ALIASES.deepseek).toBe('deepseek-chat');
    });

    it('separates user-selectable aliases from protocol aliases', () => {
        expect(AVAILABLE_MODEL_ALIASES).toEqual(['deepseek', 'deepseek-reasoner']);
        expect(isSelectableModelAlias('deepseek')).toBe(true);
        expect(isSelectableModelAlias('deepseek-chat')).toBe(false);
    });

    it('lists gateway discovery models without duplicates', () => {
        const models = listGatewayModels();
        expect(models.map((model) => model.id)).toEqual(['deepseek', 'deepseek-chat', 'deepseek-reasoner']);
        expect(new Set(models.map((model) => model.id)).size).toBe(models.length);
        expect(isSupportedModelName('deepseek-reasoner')).toBe(true);
        expect(isSupportedModelName('claude')).toBe(false);
    });
});
