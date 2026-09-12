import * as assert from 'assert';
import {
    buildMessages,
    buildRetryInstruction,
    countSourceLines,
    matchesLineCount,
    normalizeTranslation,
    resolveLanguageName,
    splitTranslationLines,
    stripCodeFence,
    translationLines,
} from '../../translatePrompt';

describe('resolveLanguageName', () => {
    it('maps the language codes the host extension sends', () => {
        assert.strictEqual(resolveLanguageName('zh-CN'), 'Simplified Chinese');
        assert.strictEqual(resolveLanguageName('zh-TW'), 'Traditional Chinese');
        assert.strictEqual(resolveLanguageName('en'), 'English');
        assert.strictEqual(resolveLanguageName('ja'), 'Japanese');
    });

    it('repairs casing and separators', () => {
        assert.strictEqual(resolveLanguageName('zh-cn'), 'Simplified Chinese');
        assert.strictEqual(resolveLanguageName('ZH-tw'), 'Traditional Chinese');
        assert.strictEqual(resolveLanguageName('zh_TW'), 'Traditional Chinese');
    });

    it('returns empty for auto detection and blank input', () => {
        assert.strictEqual(resolveLanguageName(''), '');
        assert.strictEqual(resolveLanguageName('auto'), '');
        assert.strictEqual(resolveLanguageName(undefined), '');
    });

    it('passes unknown codes through instead of guessing', () => {
        assert.strictEqual(resolveLanguageName('xx-YY'), 'xx-YY');
        assert.strictEqual(resolveLanguageName('yue'), 'yue');
    });
});

describe('buildMessages', () => {
    it('targets the requested language instead of a hardcoded one', () => {
        const messages = buildMessages('hello', 'en', 'ja', 1);
        assert.strictEqual(messages.length, 2);
        assert.strictEqual(messages[0].role, 'system');
        assert.strictEqual(messages[1].content, 'hello');
        assert.ok(messages[0].content.includes('into Japanese'));
        assert.ok(messages[0].content.includes('from English'));
        assert.ok(!messages[0].content.includes('Chinese'));
    });

    it('states the exact expected line count', () => {
        assert.ok(buildMessages('a', 'en', 'zh-CN', 4)[0].content.includes('exactly 4 lines'));
        assert.ok(buildMessages('a', 'en', 'zh-CN', 1)[0].content.includes('exactly 1 line'));
    });

    it('asks the model to detect the language when the source is auto', () => {
        const system = buildMessages('a', 'auto', 'zh-CN', 1)[0].content;
        assert.ok(system.includes('Detect the source language yourself'));
    });

    it('defaults to English when no target is given', () => {
        assert.ok(buildMessages('a', 'en', 'auto', 1)[0].content.includes('into English'));
    });
});

describe('buildRetryInstruction', () => {
    it('repeats the required line count', () => {
        assert.ok(buildRetryInstruction(4).includes('exactly 4 lines'));
        assert.ok(buildRetryInstruction(1).includes('exactly 1 line'));
    });
});

describe('countSourceLines', () => {
    it('counts lines and ignores a trailing newline', () => {
        assert.strictEqual(countSourceLines('hello'), 1);
        assert.strictEqual(countSourceLines('hello\nworld'), 2);
        assert.strictEqual(countSourceLines('hello\nworld\n'), 2);
    });

    it('handles CRLF input', () => {
        assert.strictEqual(countSourceLines('hello\r\nworld'), 2);
    });
});

describe('stripCodeFence', () => {
    const fence = String.fromCharCode(96, 96, 96);

    it('removes a wrapping fence', () => {
        assert.strictEqual(stripCodeFence(fence + 'ts\nhello\n' + fence), 'hello');
        assert.strictEqual(stripCodeFence(fence + '\nhello\n' + fence), 'hello');
    });

    it('leaves unfenced text untouched', () => {
        assert.strictEqual(stripCodeFence('hello\nworld'), 'hello\nworld');
    });

    it('keeps inner fences of a partially fenced answer', () => {
        const raw = 'hello\n' + fence + 'js\nconst a = 1;\n' + fence;
        assert.strictEqual(stripCodeFence(raw), raw);
    });
});

describe('translationLines', () => {
    it('drops blank lines the model added around the answer', () => {
        assert.deepStrictEqual(translationLines('\n\nhello\nworld\n\n'), ['hello', 'world']);
    });

    it('normalizes CRLF replies', () => {
        assert.deepStrictEqual(translationLines('hello\r\nworld'), ['hello', 'world']);
    });
});

describe('normalizeTranslation', () => {
    it('keeps a well formed answer as is', () => {
        assert.strictEqual(normalizeTranslation('你好\n世界', 2), '你好\n世界');
    });

    it('always produces the exact requested line count', () => {
        const responses = [
            '你好',
            '你好\n世界',
            '你好\n世界\n再次',
            '你好\n\n\n世界',
            String.fromCharCode(96, 96, 96) + '\n你好\n世界\n再次\n' + String.fromCharCode(96, 96, 96),
            '',
        ];
        for (const response of responses) {
            for (const expected of [1, 2, 3]) {
                assert.strictEqual(
                    splitTranslationLines(normalizeTranslation(response, expected)).length,
                    expected,
                    'response=' + JSON.stringify(response) + ' expected=' + expected
                );
            }
        }
    });

    it('folds an over long answer into a single line', () => {
        assert.strictEqual(normalizeTranslation('你好\n世界', 1), '你好 世界');
    });

    it('merges the overflow into the last line', () => {
        assert.strictEqual(normalizeTranslation('一\n二\n三\n四', 2), '一\n二 三 四');
    });

    it('pads a short answer so the source lines stay aligned', () => {
        assert.strictEqual(normalizeTranslation('一\n二', 4), '一\n二\n\n');
    });
});

describe('matchesLineCount', () => {
    it('accepts an answer after trimming blank edges', () => {
        assert.strictEqual(matchesLineCount('\n你好\n世界\n', 2), true);
    });

    it('rejects a merged answer', () => {
        assert.strictEqual(matchesLineCount('你好', 2), false);
    });

    it('rejects a padded answer', () => {
        assert.strictEqual(matchesLineCount('你好\n世界\n再次', 2), false);
    });
});
