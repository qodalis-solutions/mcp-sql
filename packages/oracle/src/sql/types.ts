import type { Metadata } from 'oracledb';

/** `varchar2(100)`, `number(10,2)`, `timestamp(6) with time zone`... from result metadata. */
export const typeNameFor = (column: Metadata): string => {
    const base = (
        column.dbTypeName ??
        column.dbType?.name?.replace(/^DB_TYPE_/, '') ??
        'unknown'
    ).toLowerCase();
    const hasPrecision = typeof column.precision === 'number' && column.precision > 0;
    const hasScale = typeof column.scale === 'number' && column.scale > 0;
    if (base === 'number') {
        if (hasPrecision) {
            return hasScale
                ? `number(${column.precision},${column.scale})`
                : `number(${column.precision})`;
        }
        return 'number';
    }
    const isSized = /^(n?varchar2|n?char|raw)$/.test(base);
    if (isSized && typeof column.byteSize === 'number' && column.byteSize > 0) {
        return `${base}(${column.byteSize})`;
    }
    return base;
};

/** Dates become ISO strings and buffers hex through core normalisation; LOB handles are flagged. */
export const normalizeCell = (value: unknown): unknown => {
    const isLob =
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { getData?: unknown }).getData === 'function';
    if (isLob) {
        return '[lob]';
    }
    return value;
};
