import { describe, expect, it } from 'vitest';
import { likePattern } from '../../../src/tools/shared.js';

describe('likePattern', () => {
    it('returns null for an empty fragment', () => {
        expect(likePattern(undefined)).toBeNull();
        expect(likePattern('')).toBeNull();
    });

    it('escapes wildcards with brackets for SQL Server', () => {
        expect(likePattern('a%b_c[d', 'brackets')).toBe('%a[%]b[_]c[[]d%');
    });

    it('escapes wildcards and backslashes with a backslash by default', () => {
        expect(likePattern('a%b_c\\d')).toBe('%a\\%b\\_c\\\\d%');
    });
});
