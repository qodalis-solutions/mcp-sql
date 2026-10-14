import {
    executeQueryTool,
    testConnectionTool,
    type AnyToolDefinition,
} from '@qodalis/mcp-sql-core';
import { describeTableTool } from './describe-table.js';
import { getForeignKeysTool } from './get-foreign-keys.js';
import { getObjectDefinitionTool } from './get-object-definition.js';
import { getServerInfoTool } from './get-server-info.js';
import { getTableStatsTool } from './get-table-stats.js';
import { listDatabasesTool } from './list-databases.js';
import { listProceduresTool } from './list-procedures.js';
import { listTablesTool } from './list-tables.js';
import { listViewsTool } from './list-views.js';
import { sampleDataTool } from './sample-data.js';
import { searchObjectsTool } from './search-objects.js';

/** Every tool the Oracle package exposes, in the order they are advertised. */
export const ALL_TOOLS = [
    testConnectionTool,
    getServerInfoTool,
    listDatabasesTool,
    listTablesTool,
    listViewsTool,
    listProceduresTool,
    describeTableTool,
    getForeignKeysTool,
    getTableStatsTool,
    getObjectDefinitionTool,
    searchObjectsTool,
    sampleDataTool,
    executeQueryTool,
] as unknown as AnyToolDefinition[];

export {
    describeTableTool,
    executeQueryTool,
    getForeignKeysTool,
    getObjectDefinitionTool,
    getServerInfoTool,
    getTableStatsTool,
    listDatabasesTool,
    listProceduresTool,
    listTablesTool,
    listViewsTool,
    sampleDataTool,
    searchObjectsTool,
    testConnectionTool,
};
