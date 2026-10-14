/**
 * Error classification and sanitisation.
 */
const CONNECTION_CODES = new Set([
    'ESOCKET',
    'ECONNCLOSED',
    'ENOTOPEN',
    'ETIMEOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    'EINSTLOOKUP',
    // PostgreSQL SQLSTATE classes 08 (connection exception) and 57P0x (operator intervention)
    '08000',
    '08001',
    '08003',
    '08004',
    '08006',
    '57P01',
    '57P02',
    '57P03',
    // mysql2
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'PROTOCOL_ENQUEUE_AFTER_QUIT',
    'PROTOCOL_SEQUENCE_TIMEOUT',
    'ER_SERVER_SHUTDOWN',
    'ETIMEDOUT',
    // oracledb (thin mode) and Oracle server errors
    'ORA-03113',
    'ORA-03114',
    'ORA-03135',
    'ORA-12541',
    'ORA-12514',
    'ORA-12170',
    'ORA-01033',
    'ORA-01089',
    'ORA-00028',
    'NJS-500',
    'NJS-503',
    'NJS-510',
    'NJS-511',
    'NJS-518',
]);

/** Authentication failures are never retried, whatever the transport looks like. */
const LOGIN_CODES = new Set(['ELOGIN', '28P01', 'ER_ACCESS_DENIED_ERROR', 'ORA-01017']);

const CONNECTION_MESSAGES = [
    /connection is closed/i,
    /connection lost/i,
    /connection not yet open/i,
    /connection is closing/i,
    /failed to connect/i,
    /socket hang up/i,
    /ECONNRESET/,
    /ETIMEDOUT/,
    /EPIPE/,
    /connection terminated/i,
    /terminating connection/i,
    /server closed the connection/i,
    /^timeout expired$/i,
    /database system is (starting up|shutting down)/i,
    /\bORA-(03113|03114|03135|12541|12514|12170|01033|01089|00028)\b/,
    /\bNJS-(500|503|510|511|518)\b/,
];

type ErrorLike = Error & {
    code?: unknown;
    lineNumber?: unknown;
    number?: unknown;
    originalError?: unknown;
};

const asErrorLike = (value: unknown): ErrorLike | undefined =>
    value instanceof Error ? (value as ErrorLike) : undefined;

/**
 * True when the failure is about the transport (socket, pool, DNS, timeout
 * while connecting) rather than the SQL itself. Such failures are safe to retry
 * once on a fresh pool. Login failures are deliberately excluded.
 */
export const isConnectionError = (value: unknown): boolean => {
    const error = asErrorLike(value);
    if (!error) {
        return false;
    }
    if (typeof error.code === 'string' && CONNECTION_CODES.has(error.code)) {
        return true;
    }
    if (typeof error.code === 'string' && LOGIN_CODES.has(error.code)) {
        return false;
    }
    if (CONNECTION_MESSAGES.some((pattern) => pattern.test(error.message))) {
        return true;
    }
    return isConnectionError(error.originalError);
};

/** Replaces each secret in the text with `[redacted]`. */
export const redactSecrets = (text: string, secrets: Array<string | undefined>): string =>
    secrets.reduce<string>((current, secret) => {
        if (!secret) {
            return current;
        }
        return current.split(secret).join('[redacted]');
    }, text);

export type PublicError = {
    code?: string;
    lineNumber?: number;
    message: string;
    number?: number;
};

/** Shapes any thrown value into a safe, serialisable description. */
export const toPublicError = (value: unknown, secrets: Array<string | undefined>): PublicError => {
    const error = asErrorLike(value);
    const rawMessage = error ? error.message : String(value);
    const result: PublicError = { message: redactSecrets(rawMessage, secrets) };
    if (error && typeof error.code === 'string') {
        result.code = error.code;
    }
    if (error && typeof error.number === 'number') {
        result.number = error.number;
    }
    if (error && typeof error.lineNumber === 'number') {
        result.lineNumber = error.lineNumber;
    }
    return result;
};
