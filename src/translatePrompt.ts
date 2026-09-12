/**
 * Pure prompt and line-alignment helpers.
 *
 * This module deliberately imports nothing from `vscode` so the logic can be
 * unit tested (see `npm run test:unit`) and reasoned about in isolation.
 */

/**
 * `commentTranslate.targetLanguage` hands us Google style codes such as `zh-CN`.
 * A model follows a full language name more reliably than a bare code, but only
 * the `zh` variants are genuinely ambiguous, so the table stays small and any
 * unknown code is passed through unchanged (models understand ISO codes fine).
 */
const LANGUAGE_NAMES: Record<string, string> = {
    'zh-CN': 'Simplified Chinese',
    'zh-TW': 'Traditional Chinese',
    zh: 'Chinese',
    en: 'English',
    ja: 'Japanese',
    ko: 'Korean',
    fr: 'French',
    de: 'German',
    es: 'Spanish',
    it: 'Italian',
    pt: 'Portuguese',
    ru: 'Russian',
    ar: 'Arabic',
    hi: 'Hindi',
    th: 'Thai',
    vi: 'Vietnamese',
    id: 'Indonesian',
    ms: 'Malay',
    tr: 'Turkish',
    pl: 'Polish',
    nl: 'Dutch',
    sv: 'Swedish',
    da: 'Danish',
    fi: 'Finnish',
    no: 'Norwegian',
    cs: 'Czech',
    el: 'Greek',
    he: 'Hebrew',
    uk: 'Ukrainian',
    ro: 'Romanian',
    hu: 'Hungarian',
};

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Resolve a language code into something a model reliably understands.
 * Returns an empty string for `auto`, which means "let the model detect it".
 */
export function resolveLanguageName(code: string | undefined): string {
    const key = (code || '').trim();
    if (!key || key === 'auto') {
        return '';
    }

    const direct = LANGUAGE_NAMES[key];
    if (direct) {
        return direct;
    }

    const lower = key.replace(/_/g, '-').toLowerCase();
    if (LANGUAGE_NAMES[lower]) {
        return LANGUAGE_NAMES[lower];
    }

    // zh-cn -> zh-CN
    const parts = lower.split('-');
    if (parts.length === 2) {
        const caseFixed = `${parts[0]}-${parts[1].toUpperCase()}`;
        if (LANGUAGE_NAMES[caseFixed]) {
            return LANGUAGE_NAMES[caseFixed];
        }
    }

    return key;
}

/**
 * Build the chat messages.
 *
 * The line-count rule is not cosmetic: the host extension
 * (`src/syntax/compile.ts`) splits the answer on `\n` and only writes it back
 * when the line count matches the source exactly, so an answer that merged or
 * dropped a line is discarded in full.
 */
export function buildMessages(
    content: string,
    from: string | undefined,
    to: string | undefined,
    expectedLineCount: number
): ChatMessage[] {
    const targetName = resolveLanguageName(to) || 'English';
    const sourceName = resolveLanguageName(from);
    const direction = sourceName
        ? `Translate the text the user sends from ${sourceName} into ${targetName}.`
        : `Translate the text the user sends into ${targetName}. Detect the source language yourself.`;
    const lines = expectedLineCount === 1 ? 'exactly 1 line' : `exactly ${expectedLineCount} lines`;

    const system = [
        `You are a translation engine embedded in a code editor. ${direction}`,
        'Rules:',
        '1. Reply with the translation only. No explanation, no note, no code fence, no surrounding quotes.',
        `2. The input has ${lines}. Your reply must have the same number of lines, in the same order, one output line per input line.`,
        '3. Never merge lines, never split a line, never add or remove blank lines.',
        `4. If a line is already in ${targetName}, is pure code, or has nothing to translate, copy it through unchanged.`,
        '5. Keep identifiers, keywords, file paths, URLs, numbers and inline code spans unchanged.',
    ].join('\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content },
    ];
}

/** Follow-up message used when the model broke the line-count contract. */
export function buildRetryInstruction(expectedLineCount: number): string {
    const lines = expectedLineCount === 1 ? 'exactly 1 line' : `exactly ${expectedLineCount} lines`;
    return [
        `Your previous reply did not contain ${lines}.`,
        `Send the translation again with ${lines}, one line per input line, nothing else.`,
        'Do not add notes, code fences or blank lines.',
    ].join(' ');
}

export function splitTranslationLines(text: string): string[] {
    return text.replace(/\r\n?/g, '\n').split('\n');
}

/** Models sometimes wrap the answer in a fenced block even when told not to. */
export function stripCodeFence(text: string): string {
    const trimmed = text.trim();
    const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
    return match ? match[1] : trimmed;
}

function trimBlankEdges(lines: string[]): string[] {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start].trim() === '') {
        start += 1;
    }
    while (end > start && lines[end - 1].trim() === '') {
        end -= 1;
    }
    return lines.slice(start, end);
}

/**
 * Force an exact line count. A single-line target folds extra lines back into
 * one, a longer target merges the overflow into the last line, and a short
 * answer is padded so the remaining source lines stay untouched.
 */
function fitLineCount(lines: string[], expected: number): string[] {
    if (expected <= 0 || lines.length === expected) {
        return lines;
    }
    if (lines.length > expected) {
        const head = lines.slice(0, expected - 1);
        const tail = lines.slice(expected - 1).map(line => line.trim()).filter(Boolean).join(' ');
        return [...head, tail];
    }
    const padded = lines.slice();
    while (padded.length < expected) {
        padded.push('');
    }
    return padded;
}

/** Model output as trimmed, fence-free lines. */
export function translationLines(raw: string): string[] {
    return trimBlankEdges(splitTranslationLines(stripCodeFence(raw)));
}

/** Whether the reply already respects the line-count contract. */
export function matchesLineCount(raw: string, expectedLineCount: number): boolean {
    return translationLines(raw).length === expectedLineCount;
}

/**
 * Normalize a model reply so it always has exactly `expectedLineCount` lines,
 * which is the contract the host extension requires to map translations back
 * onto comment tokens.
 */
export function normalizeTranslation(raw: string, expectedLineCount: number): string {
    const lines = translationLines(raw);
    if (expectedLineCount <= 0) {
        return lines.join('\n');
    }
    return fitLineCount(lines, expectedLineCount).join('\n');
}

/**
 * Line count of the text handed to the translator. The host joins the
 * non-empty source lines with `\n`, so a trailing newline must not be counted
 * as an extra line.
 */
export function countSourceLines(text: string): number {
    const lines = splitTranslationLines(text);
    while (lines.length > 1 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines.length;
}
