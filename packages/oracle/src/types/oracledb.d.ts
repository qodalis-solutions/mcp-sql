/**
 * Minimal typing of the `oracledb` surface this package uses. The driver ships
 * no bundled types; install `@types/oracledb` for the full API.
 */
declare module 'oracledb' {
    export type DbType = { num: number; name: string };

    export type Metadata = {
        byteSize?: number;
        dbType?: DbType;
        dbTypeName?: string;
        name: string;
        nullable?: boolean;
        precision?: number;
        scale?: number;
    };

    export type BindValue = string | number | Date | Buffer | null;
    export type BindParameters = Record<string, BindValue>;

    export type FetchTypeHandlerResult =
        { type?: DbType; converter?: (value: unknown) => unknown } | undefined;

    export type ExecuteOptions = {
        autoCommit?: boolean;
        fetchArraySize?: number;
        fetchTypeHandler?: (metaData: Metadata) => FetchTypeHandlerResult;
        outFormat?: number;
        prefetchRows?: number;
        resultSet?: boolean;
    };

    export type ResultSet = {
        close(): Promise<void>;
        getRows(numRows?: number): Promise<unknown[][]>;
        metaData: Metadata[];
    };

    export type Result = {
        metaData?: Metadata[];
        resultSet?: ResultSet;
        rows?: unknown[][];
        rowsAffected?: number;
    };

    export type Connection = {
        callTimeout: number;
        close(options?: { drop?: boolean }): Promise<void>;
        commit(): Promise<void>;
        execute(sql: string, binds?: BindParameters, options?: ExecuteOptions): Promise<Result>;
        rollback(): Promise<void>;
    };

    export type ConnectionAttributes = {
        connectString: string;
        password?: string;
        privilege?: number;
        user?: string;
    };

    export type Pool = {
        close(drainTime?: number): Promise<void>;
        getConnection(): Promise<Connection>;
        status: number;
    };

    export type PoolAttributes = {
        configDir?: string;
        connectString: string;
        connectTimeout?: number;
        enableStatistics?: boolean;
        homogeneous?: boolean;
        password?: string;
        poolIncrement?: number;
        poolMax?: number;
        poolMin?: number;
        poolTimeout?: number;
        queueTimeout?: number;
        stmtCacheSize?: number;
        user?: string;
        walletLocation?: string;
        walletPassword?: string;
    };

    export type DBError = Error & { code?: string; errorNum?: number; offset?: number };

    export const OUT_FORMAT_ARRAY: number;
    export const DB_TYPE_CLOB: DbType;
    export const DB_TYPE_NCLOB: DbType;
    export const DB_TYPE_BLOB: DbType;
    export const DB_TYPE_VARCHAR: DbType;
    export const DB_TYPE_RAW: DbType;
    export const DB_TYPE_LONG: DbType;
    export const DB_TYPE_LONG_RAW: DbType;
    export const POOL_STATUS_OPEN: number;
    export const thin: boolean;
    export const versionString: string;
    export function createPool(attributes: PoolAttributes): Promise<Pool>;
    export function getConnection(attributes: ConnectionAttributes): Promise<Connection>;

    const oracledb: {
        OUT_FORMAT_ARRAY: number;
        DB_TYPE_CLOB: DbType;
        DB_TYPE_NCLOB: DbType;
        DB_TYPE_BLOB: DbType;
        DB_TYPE_VARCHAR: DbType;
        DB_TYPE_RAW: DbType;
        DB_TYPE_LONG: DbType;
        DB_TYPE_LONG_RAW: DbType;
        POOL_STATUS_OPEN: number;
        thin: boolean;
        versionString: string;
        createPool(attributes: PoolAttributes): Promise<Pool>;
        getConnection(attributes: ConnectionAttributes): Promise<Connection>;
    };
    export default oracledb;
}
