/**
 * Human-readable names for the MySQL protocol column types seen in results.
 * The codes are the wire-protocol constants (`enum_field_types`), which are
 * stable across MySQL and MariaDB; they are listed here so the package does
 * not depend on mysql2's internal export shape.
 */
const BINARY_FLAG = 128;

const NAMES: Record<number, string> = {
    0: 'decimal',
    1: 'tinyint',
    2: 'smallint',
    3: 'int',
    4: 'float',
    5: 'double',
    6: 'null',
    7: 'timestamp',
    8: 'bigint',
    9: 'mediumint',
    10: 'date',
    11: 'time',
    12: 'datetime',
    13: 'year',
    14: 'date',
    15: 'varchar',
    16: 'bit',
    242: 'vector',
    245: 'json',
    246: 'decimal',
    247: 'enum',
    248: 'set',
    253: 'varchar',
    254: 'char',
    255: 'geometry',
};

/** Blob codes carry text or binary data depending on the BINARY flag. */
const BLOBS: Record<number, [string, string]> = {
    249: ['tinytext', 'tinyblob'],
    250: ['mediumtext', 'mediumblob'],
    251: ['longtext', 'longblob'],
    252: ['text', 'blob'],
};

/** Human-readable type name for a result column from its protocol type and flags. */
export const typeNameForColumn = (columnType: number, flags: number): string => {
    const blob = BLOBS[columnType];
    if (blob) {
        return (flags & BINARY_FLAG) !== 0 ? blob[1] : blob[0];
    }
    return NAMES[columnType] ?? `type:${columnType}`;
};
