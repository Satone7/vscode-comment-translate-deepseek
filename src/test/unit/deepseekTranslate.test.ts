import * as assert from 'assert';

// ---------------------------------------------------------------------------
// The provider talks to the host through `vscode` and to the network through
// `axios`. Both are stubbed below so the whole translate() flow can run
// offline, before the provider module is loaded.
// ---------------------------------------------------------------------------
const ModuleLib = require('module');
const originalLoad = ModuleLib._load;

interface RecordedRequest {
    url: string;
    body: any;
    headers: any;
}

const state: {
    config: Record<string, unknown>;
    requests: RecordedRequest[];
    responses: any[];
} = { config: {}, requests: [], responses: [] };

const vscodeStub = {
    workspace: {
        getConfiguration: () => ({
            get: (key: string) => state.config[key],
        }),
        onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    },
    window: {
        createStatusBarItem: () => ({ text: '', show: () => undefined, dispose: () => undefined }),
        showInformationMessage: () => Promise.resolve(undefined),
        showErrorMessage: () => Promise.resolve(undefined),
    },
};

const axiosStub = {
    post: async (url: string, body: any, options: any) => {
        state.requests.push({ url, body, headers: options.headers });
        const next = state.responses.shift();
        if (next instanceof Error) {
            throw next;
        }
        return { data: next };
    },
};

ModuleLib._load = function (request: string, ...rest: any[]) {
    if (request === 'vscode') {
        return vscodeStub;
    }
    if (request === 'axios') {
        return { __esModule: true, default: axiosStub };
    }
    return originalLoad.call(this, request, ...rest);
};

const { DeepSeekTranslate, DEFAULT_MODEL } = require('../../deepseekTranslate');

/** Reply the way the real endpoint would. */
function reply(content: string) {
    return { model: DEFAULT_MODEL, choices: [{ message: { content } }] };
}

describe('DeepSeekTranslate', () => {
    let translator: any;

    function setup(config: Record<string, unknown>) {
        state.config = Object.assign({ apiType: 'openai', authKey: 'sk-test' }, config);
        state.requests = [];
        state.responses = [];
        translator = new DeepSeekTranslate();
    }

    after(() => {
        ModuleLib._load = originalLoad;
    });

    it('posts a chat completion to the official endpoint', async () => {
        setup({});
        state.responses.push(reply('你好'));

        const result = await translator.translate('hello', { from: 'en', to: 'zh-CN' });

        assert.strictEqual(result, '你好');
        assert.strictEqual(state.requests.length, 1);

        const request = state.requests[0];
        assert.strictEqual(request.url, 'https://api.deepseek.com/chat/completions');
        assert.strictEqual(request.headers.Authorization, 'Bearer sk-test');
        assert.strictEqual(request.body.model, DEFAULT_MODEL);
        assert.strictEqual(request.body.temperature, 0);
        assert.strictEqual(request.body.stream, false);
        assert.strictEqual(request.body.frequency_penalty, undefined);
        assert.strictEqual(request.body.presence_penalty, undefined);
        assert.strictEqual(request.body.messages.length, 2);
        assert.strictEqual(request.body.messages[0].role, 'system');
        assert.ok(request.body.messages[0].content.includes('Simplified Chinese'));
        assert.strictEqual(request.body.messages[1].content, 'hello');
    });

    it('honours the configured base url and model', async () => {
        setup({ apiBaseUrl: 'https://proxy.example.com/', model: 'deepseek-v4.1-pro' });
        state.responses.push(reply('ok'));

        await translator.translate('hello', { from: 'en', to: 'ja' });

        assert.strictEqual(state.requests[0].url, 'https://proxy.example.com/chat/completions');
        assert.strictEqual(state.requests[0].body.model, 'deepseek-v4.1-pro');
    });

    it('targets the language the host asked for, not a hardcoded one', async () => {
        setup({});
        state.responses.push(reply('こんにちは'));

        await translator.translate('hello', { from: 'en', to: 'ja' });

        const system = state.requests[0].body.messages[0].content;
        assert.ok(system.includes('into Japanese'));
        assert.ok(!system.includes('Chinese'));
    });

    it('uses the ollama generate endpoint when configured', async () => {
        setup({ apiType: 'ollama', apiBaseUrl: 'http://127.0.0.1:11434', authKey: undefined });
        state.responses.push({ model: 'qwen2.5', response: '你好' });

        const result = await translator.translate('hello', { from: 'en', to: 'zh-CN' });

        assert.strictEqual(result, '你好');
        assert.strictEqual(state.requests[0].url, 'http://127.0.0.1:11434/api/generate');
        assert.strictEqual(state.requests[0].headers.Authorization, undefined);
        assert.strictEqual(state.requests[0].body.stream, false);
        assert.ok(typeof state.requests[0].body.prompt === 'string');
    });

    it('refuses to call the api without an auth key', async () => {
        setup({ authKey: undefined });

        await assert.rejects(
            () => translator.translate('hello', { to: 'zh-CN' }),
            /authKey/
        );
        assert.strictEqual(state.requests.length, 0);
    });

    it('skips the request for blank input', async () => {
        setup({});

        assert.strictEqual(await translator.translate('   ', { to: 'zh-CN' }), '   ');
        assert.strictEqual(state.requests.length, 0);
    });

    it('retries once when a multi line answer breaks the line contract', async () => {
        setup({});
        state.responses.push(reply('你好'));
        state.responses.push(reply('你好\n世界'));

        const result = await translator.translate('hello\nworld', { from: 'en', to: 'zh-CN' });

        assert.strictEqual(result, '你好\n世界');
        assert.strictEqual(state.requests.length, 2);

        const retryMessages = state.requests[1].body.messages;
        assert.strictEqual(retryMessages.length, 3);
        assert.ok(retryMessages[2].content.includes('exactly 2 lines'));
    });

    it('keeps the first answer when the retry is no better, still aligned', async () => {
        setup({});
        state.responses.push(reply('一\n二\n三'));
        state.responses.push(reply('一\n二\n三'));

        const result = await translator.translate('a\nb', { from: 'en', to: 'zh-CN' });

        assert.strictEqual(result.split('\n').length, 2);
        assert.strictEqual(state.requests.length, 2);
    });

    it('does not retry a single line answer', async () => {
        setup({});
        state.responses.push(reply('你好'));

        await translator.translate('hello', { from: 'en', to: 'zh-CN' });

        assert.strictEqual(state.requests.length, 1);
    });

    it('reports an authentication failure in plain language', async () => {
        setup({});
        const error: any = new Error('Request failed with status code 401');
        error.response = { status: 401 };
        state.responses.push(error);

        await assert.rejects(
            () => translator.translate('hello', { to: 'zh-CN' }),
            /认证失败/
        );
    });

    it('rejects an empty completion instead of blanking the comment', async () => {
        setup({});
        state.responses.push(reply('   '));

        await assert.rejects(
            () => translator.translate('hello', { to: 'zh-CN' }),
            /empty translation/
        );
    });
});
