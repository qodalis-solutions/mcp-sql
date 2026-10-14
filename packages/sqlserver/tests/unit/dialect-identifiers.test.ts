import { describe, expect, it } from 'vitest';
import { identifiers } from '../../src/dialect.js';

const { parseObjectName, quoteIdentifier, qualifiedName } = identifiers;

describe('quoteIdentifier', () => {
    it('wraps names in brackets', () => {
        expect(quoteIdentifier('Orders')).toBe('[Orders]');
    });

    it('escapes closing brackets', () => {
        expect(quoteIdentifier('we]ird')).toBe('[we]]ird]');
    });

    it('strips brackets the caller already added', () => {
        expect(quoteIdentifier('[Orders]')).toBe('[Orders]');
    });

    it('rejects empty and overlong names', () => {
        expect(() => quoteIdentifier('')).toThrow(/identifier/i);
        expect(() => quoteIdentifier('x'.repeat(129))).toThrow(/identifier/i);
    });
});

describe('parseObjectName', () => {
    it('splits schema.name', () => {
        expect(parseObjectName('sales.Orders')).toEqual({ schema: 'sales', name: 'Orders' });
    });

    it('defaults the schema to dbo', () => {
        expect(parseObjectName('Orders')).toEqual({ schema: 'dbo', name: 'Orders' });
    });

    it('lets an explicit schema argument override a bare name', () => {
        expect(parseObjectName('Orders', 'archive')).toEqual({ schema: 'archive', name: 'Orders' });
    });

    it('understands bracketed parts', () => {
        expect(parseObjectName('[my schema].[My Table]')).toEqual({
            schema: 'my schema',
            name: 'My Table',
        });
    });

    it('rejects three-part names to keep queries inside the selected database', () => {
        expect(() => parseObjectName('Other.dbo.T')).toThrow(/schema\.name/i);
    });
});

describe('qualifiedName', () => {
    it('quotes both parts', () => {
        expect(qualifiedName({ schema: 'dbo', name: 'Or]ders' })).toBe('[dbo].[Or]]ders]');
    });
});
