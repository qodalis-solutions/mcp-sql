import { describe, expect, it } from 'vitest';
import { isConnectionError, redactSecrets, toPublicError } from '../../src/sql/errors.js';

const withCode = (code: string, message = 'boom'): Error =>
    Object.assign(new Error(message), { code });

describe('isConnectionError', () => {
    it.each([
        ['57P01', 'terminating connection due to administrator command'],
        ['57P02', 'terminating connection due to crash'],
        ['57P03', 'the database system is starting up'],
        ['08006', 'connection failure'],
        ['08003', 'connection does not exist'],
        ['08001', 'could not connect'],
    ])('recognises PostgreSQL connection SQLSTATE %s', (code, message) => {
        expect(isConnectionError(Object.assign(new Error(message), { code }))).toBe(true);
    });

    it.each([
        'Connection terminated unexpectedly',
        'Connection terminated',
        'terminating connection due to administrator command',
        'server closed the connection unexpectedly',
        'timeout expired',
        'the database system is shutting down',
    ])('recognises the pg driver message "%s"', (message) => {
        expect(isConnectionError(new Error(message))).toBe(true);
    });

    it('does not treat PostgreSQL authentication failures as connection errors', () => {
        expect(
            isConnectionError(
                Object.assign(new Error('password authentication failed for user "reader"'), {
                    code: '28P01',
                }),
            ),
        ).toBe(false);
    });

    it.each(['ESOCKET', 'ECONNCLOSED', 'ENOTOPEN', 'ETIMEOUT', 'ECONNRESET', 'EPIPE', 'ENOTFOUND'])(
        'is true for driver/socket code %s',
        (code) => {
            expect(isConnectionError(withCode(code))).toBe(true);
        },
    );

    it.each([
        'Connection is closed.',
        'Connection lost - socket hang up',
        'Failed to connect to db:1433 in 8000ms',
        'Connection not yet open.',
        'read ECONNRESET',
    ])('is true for message "%s"', (message) => {
        expect(isConnectionError(new Error(message))).toBe(true);
    });

    it('is false for SQL errors such as a missing object', () => {
        expect(isConnectionError(withCode('EREQUEST', "Invalid object name 'Nope'."))).toBe(false);
    });

    it('is false for a login failure so credentials problems are not retried forever', () => {
        expect(isConnectionError(withCode('ELOGIN', 'Login failed for user'))).toBe(false);
    });

    it('is false for non-error values', () => {
        expect(isConnectionError('nope')).toBe(false);
        expect(isConnectionError(undefined)).toBe(false);
    });
});

describe('redactSecrets', () => {
    it('replaces every occurrence of each secret', () => {
        expect(redactSecrets('pw=hunter2 again hunter2', ['hunter2'])).toBe(
            'pw=[redacted] again [redacted]',
        );
    });

    it('ignores empty secrets', () => {
        expect(redactSecrets('nothing', ['', undefined])).toBe('nothing');
    });
});

describe('toPublicError', () => {
    it('includes the driver code, the message, and the SQL line number when present', () => {
        const error = Object.assign(new Error("Invalid column name 'x'."), {
            code: 'EREQUEST',
            number: 207,
            lineNumber: 3,
        });

        expect(toPublicError(error, [])).toEqual({
            code: 'EREQUEST',
            message: "Invalid column name 'x'.",
            number: 207,
            lineNumber: 3,
        });
    });

    it('redacts secrets from the message and never exposes a stack', () => {
        const error = new Error('login failed with password=topsecret');
        const result = toPublicError(error, ['topsecret']);

        expect(result.message).toBe('login failed with password=[redacted]');
        expect(result).not.toHaveProperty('stack');
    });

    it('describes non-Error values', () => {
        expect(toPublicError('plain string', []).message).toBe('plain string');
    });
});
