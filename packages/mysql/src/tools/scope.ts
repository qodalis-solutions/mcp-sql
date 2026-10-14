import {
    resolveDatabase,
    type Dialect,
    type ObjectName,
    type ToolContext,
} from '@qodalis/mcp-sql-core';

/**
 * MySQL has no schema below the database, so "schema" in every tool means the
 * database. An explicit `schema` argument wins, then the `database` argument,
 * then the configured database; when none is known the SQL falls back to
 * `database()` through `coalesce(@schema, database())`.
 */
export type Scope = {
    /** Database to run the query against (undefined = pool default). */
    database: string | undefined;
    /** Database name used in catalog filters, or null for `database()`. */
    schema: string | null;
};

export const resolveScope = (
    context: ToolContext,
    args: { database?: string | undefined; schema?: string | undefined },
): Scope => {
    const database = resolveDatabase(context, args.database);
    return { database, schema: args.schema ?? database ?? null };
};

/** Parses a table name, defaulting its database to the scope. */
export const scopedObject = (
    dialect: Dialect,
    table: string,
    scope: Scope,
): { object: ObjectName; params: { schema: string | null; table: string } } => {
    const object = dialect.identifiers.parseObjectName(table, scope.schema ?? undefined);
    return { object, params: { schema: object.schema || null, table: object.name } };
};

/** `db`.`name`, or just `name` when no database is known. */
export const scopedName = (dialect: Dialect, object: ObjectName): string =>
    object.schema
        ? dialect.identifiers.qualifiedName(object)
        : dialect.identifiers.quoteIdentifier(object.name);

export const displayName = (object: ObjectName): string =>
    object.schema ? `${object.schema}.${object.name}` : object.name;

/** Databases that are never listed or searched. */
export const SYSTEM_SCHEMAS = "('information_schema', 'performance_schema', 'mysql', 'sys')";
