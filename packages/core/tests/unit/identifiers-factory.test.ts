import { describe, expect, it } from 'vitest';
import { createIdentifierTools } from '../../src/sql/identifiers.js';

const pg = createIdentifierTools({ open: '"', close: '"', defaultSchema: 'public', maxLength: 63 });
const my = createIdentifierTools({ open: '`', close: '`', defaultSchema: 'mydb', maxLength: 64 });

describe('createIdentifierTools', () => {
    it('quotes with the dialect characters and doubles embedded closers', () => {
        expect(pg.quoteIdentifier('we"ird')).toBe('"we""ird"');
        expect(my.quoteIdentifier('we`ird')).toBe('`we``ird`');
    });

    it('strips quotes the caller already added', () => {
        expect(pg.quoteIdentifier('"Orders"')).toBe('"Orders"');
    });

    it('enforces the dialect maximum length', () => {
        expect(() => pg.quoteIdentifier('x'.repeat(64))).toThrow(/1-63/);
    });

    it('uses the dialect default schema', () => {
        expect(pg.parseObjectName('orders')).toEqual({ schema: 'public', name: 'orders' });
        expect(my.parseObjectName('orders')).toEqual({ schema: 'mydb', name: 'orders' });
    });

    it('splits on dots outside quotes only', () => {
        expect(pg.parseObjectName('"my.schema"."my.table"')).toEqual({
            schema: 'my.schema',
            name: 'my.table',
        });
    });

    it('rejects three-part names', () => {
        expect(() => pg.parseObjectName('a.b.c')).toThrow(/schema\.name/);
    });

    it('builds a fully quoted qualified name', () => {
        expect(pg.qualifiedName({ schema: 'public', name: 'Or"ders' })).toBe('"public"."Or""ders"');
    });
});
