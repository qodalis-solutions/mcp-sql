# Tool reference

Every tool accepts an optional `database` argument. It defaults to
`SQLSERVER_DATABASE` and, when `SQLSERVER_DATABASES` is set, must be one of the
allowlisted names (matched case-insensitively).

Result sets are returned as compact JSON:

```json
{
  "columns": ["Id", "Name"],
  "rowCount": 2,
  "rows": [
    [1, "a"],
    [2, "b"]
  ],
  "truncated": false
}
```

`truncated: true` means the `SQLSERVER_MAX_ROWS` (or per-call) cap was hit.
Dates are ISO 8601 strings, binary values are `0x…` hex, `bigint` values are
strings, `NULL` is `null`.

## test_connection

Runs `select db_name(), suser_sname(), sysdatetimeoffset()`.

Returns `{ ok, server, database, login, serverTime, readOnly, pool: { connected, connecting }, durationMs }`.
On failure it returns `ok: false` with `error: { code, message }` and a `hint`,
and marks the result `isError`. It never throws, so it is safe for health checks.

## get_server_info

No arguments beyond `database`. Returns `productVersion`, `productLevel`,
`edition`, `engineEdition`, `machineName`, `serverName`, `instanceName`,
`collation`, `isClustered`, `database`, `login`, `serverTime`, `version`.

## list_databases

Columns: `name`, `state`, `recoveryModel`, `compatibilityLevel`, `collation`, `createDate`.

## list_tables

| Argument           | Type    | Default | Description                                             |
| ------------------ | ------- | ------- | ------------------------------------------------------- |
| `schema`           | string  | all     | Exact schema name.                                      |
| `nameContains`     | string  | none    | Case-insensitive substring of the table name.           |
| `includeRowCounts` | boolean | `true`  | Approximate row count from `sys.dm_db_partition_stats`. |

Columns: `schema`, `name`, `rowCount` (when requested), `createDate`, `modifyDate`.

## list_views

Arguments `schema`, `nameContains`. Columns: `schema`, `name`, `createDate`, `modifyDate`.

## list_procedures

| Argument                 | Type                               | Default |
| ------------------------ | ---------------------------------- | ------- |
| `kind`                   | `all` \| `procedure` \| `function` | `all`   |
| `schema`, `nameContains` | string                             | none    |

Columns: `schema`, `name`, `kind`, `createDate`, `modifyDate`.

## describe_table

| Argument | Type   | Description                                          |
| -------- | ------ | ---------------------------------------------------- |
| `table`  | string | `name` or `schema.name`; brackets allowed.           |
| `schema` | string | Used when `table` has no schema part. Default `dbo`. |

Returns:

```json
{
  "table": "dbo.Orders",
  "columns": [
    {
      "name": "Id",
      "type": "int",
      "nullable": false,
      "identity": true,
      "computed": false,
      "default": null
    }
  ],
  "indexes": [
    {
      "name": "PK_Orders",
      "type": "CLUSTERED",
      "is_primary_key": true,
      "is_unique": true,
      "is_unique_constraint": false,
      "filter": null,
      "columns": "Id",
      "included": null
    }
  ],
  "foreignKeys": [
    {
      "name": "FK_Orders_Customers",
      "direction": "outgoing",
      "fromTable": "dbo.Orders",
      "fromColumns": "CustomerId",
      "toTable": "dbo.Customers",
      "toColumns": "Id",
      "onDelete": "NO_ACTION",
      "onUpdate": "NO_ACTION"
    }
  ]
}
```

Fails with a clear message when the table does not exist.

## get_foreign_keys

Arguments `table` (optional, either side of the relationship), `schema`.
Columns: `name`, `fromTable`, `fromColumns`, `toTable`, `toColumns`,
`onDelete`, `onUpdate`, `disabled`.

## get_table_stats

| Argument | Type    | Default | Description                               |
| -------- | ------- | ------- | ----------------------------------------- |
| `table`  | string  | none    | One table. Omit for the largest tables.   |
| `schema` | string  | `dbo`   |                                           |
| `top`    | integer | `25`    | Number of tables when `table` is omitted. |

Columns: `schema`, `table`, `rowCount`, `reservedKb`, `dataKb`, `indexKb`,
`indexCount`, `partitionCount`.

## get_object_definition

Arguments `name` (view, procedure, function or trigger), `schema`. Returns the
T-SQL text prefixed with a one-line header. Fails when the object has no
definition (for example a table) or does not exist.

## search_objects

| Argument  | Type                                                                | Default  | Description                                               |
| --------- | ------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| `pattern` | string                                                              | required | Case-insensitive substring. `%`, `_` and `[` are escaped. |
| `types`   | array of `table` \| `view` \| `procedure` \| `function` \| `column` | all      | Kinds to search.                                          |
| `limit`   | integer                                                             | `100`    | Maximum matches.                                          |

Columns: `kind`, `object` (`schema.name`), `column` (for column matches).

## sample_data

| Argument  | Type     | Default  | Description                  |
| --------- | -------- | -------- | ---------------------------- |
| `table`   | string   | required | Table or view.               |
| `schema`  | string   | `dbo`    |                              |
| `columns` | string[] | all      | Column subset.               |
| `limit`   | integer  | `10`     | Rows, max 1000.              |
| `random`  | boolean  | `false`  | `ORDER BY NEWID()` sampling. |

## execute_query

| Argument  | Type                          | Default    | Description                                                                     |
| --------- | ----------------------------- | ---------- | ------------------------------------------------------------------------------- |
| `sql`     | string                        | required   | T-SQL batch.                                                                    |
| `params`  | object                        | none       | Named parameters, referenced as `@name`. Values: string, number, boolean, null. |
| `maxRows` | integer                       | server cap | Per-call cap, never above `SQLSERVER_MAX_ROWS`.                                 |
| `format`  | `json` \| `markdown` \| `csv` | `json`     | Output format.                                                                  |

In read-only mode (the default, `SQLSERVER_READ_ONLY=true`) the batch is
checked by the statement guard before it is sent: reads, CTEs, variables and
`#temp`/`@table` work pass; persistent writes, DDL, `EXEC`, `DBCC` and
`WAITFOR` are rejected with an `isError` result and no round trip to the
server. With `SQLSERVER_READ_ONLY=false` data and schema changes are allowed;
`xp_cmdshell`, configuration, backup/restore, logins and linked-server access
are refused in both modes.

Statements without a result set report `rowsAffected`; `PRINT` output is
returned under `messages`. SQL errors come back as `isError` results with the
driver code, SQL error number and line.
