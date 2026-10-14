import { describe, expect, it } from 'vitest';
import { scrubSql, validateSql, type GuardProfile } from '../../src/sql/guard.js';

const profile: GuardProfile = {
    alwaysBlocked: [{ label: 'SHUTDOWN', pattern: /\bshutdown\b/i }],
    isSessionLocal: (target) => target.startsWith('tmp_'),
    readOnlyBlocked: [{ label: 'GRANT', pattern: /\bgrant\b/i }],
    scrub: {
        dollarQuotes: true,
        identifierQuotes: [
            ['"', '"'],
            ['`', '`'],
        ],
        lineComments: ['--', '#'],
    },
    targetedWrites: [{ label: 'INSERT', pattern: /\binsert\s+into\s+([\w.]+)/gi }],
};

describe('scrubSql (engine)', () => {
    it('honours dialect line-comment markers', () => {
        expect(scrubSql('select 1 # shutdown\n-- grant\n+ 2', profile.scrub)).toBe(
            'select 1 \n\n+ 2',
        );
    });

    it('blanks backtick and double-quoted identifiers', () => {
        expect(scrubSql('select `shutdown`, "grant" from t', profile.scrub)).toBe(
            'select ``, "" from t',
        );
    });

    it('blanks dollar-quoted strings including tagged ones', () => {
        expect(scrubSql('select $$shutdown$$, $fn$ grant $fn$', profile.scrub)).toBe(
            "select '', ''",
        );
    });

    it('leaves a lone dollar sign alone when dollar quoting is on', () => {
        expect(scrubSql('select price$ from t', profile.scrub)).toBe('select price$ from t');
    });

    it('ignores dollar quoting when the dialect does not use it', () => {
        expect(scrubSql('select $$x$$', { ...profile.scrub, dollarQuotes: false })).toBe(
            'select $$x$$',
        );
    });
});

describe('validateSql (engine)', () => {
    it('applies always-blocked rules in both modes', () => {
        expect(validateSql('shutdown', { readOnly: false }, profile).ok).toBe(false);
        expect(validateSql('shutdown', { readOnly: true }, profile).ok).toBe(false);
    });

    it('applies read-only-blocked rules only in read-only mode', () => {
        expect(validateSql('grant all', { readOnly: true }, profile).ok).toBe(false);
        expect(validateSql('grant all', { readOnly: false }, profile)).toEqual({ ok: true });
    });

    it('lets targeted writes through when every target is session-local', () => {
        expect(
            validateSql(
                'insert into tmp_a values (1); insert into tmp_b values (2)',
                { readOnly: true },
                profile,
            ),
        ).toEqual({ ok: true });
    });

    it('rejects a targeted write with one persistent target among local ones', () => {
        const result = validateSql(
            'insert into tmp_a values (1); insert into real values (2)',
            { readOnly: true },
            profile,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toContain('INSERT');
        }
    });

    it('rejects empty input', () => {
        expect(validateSql('-- nothing', { readOnly: false }, profile).ok).toBe(false);
    });
});
