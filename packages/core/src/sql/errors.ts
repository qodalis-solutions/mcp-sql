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
]);

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
    if (typeof error.code === 'string' && error.code === 'ELOGIN') {
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
