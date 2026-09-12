import axios from 'axios';
import { workspace, window, Disposable } from 'vscode';
import { ITranslate, ITranslateOptions } from 'comment-translate-manager';
import {
    ChatMessage,
    buildMessages,
    buildRetryInstruction,
    countSourceLines,
    matchesLineCount,
    normalizeTranslation,
} from './translatePrompt';

const PREFIXCONFIG = 'deepseekTranslate';
const DEFAULT_BASE_URL = 'https://api.deepseek.com';

/**
 * Must be one of the model names the API actually accepts.
 * `deepseek-v4.1-flash` is rejected with HTTP 400 — the real name is `deepseek-flash`.
 */
export const DEFAULT_MODEL = 'deepseek-flash';

/**
 * `deepseek-flash` is a reasoning model: the reply budget covers the thinking
 * tokens as well as the translation, so a low cap truncates long comments.
 */
const MAX_TOKENS = 8192;
/** axios has no timeout by default, which would hang a hover forever. */
const REQUEST_TIMEOUT_MS = 60000;
/** Coalesce rapid settings edits into a single connection test. */
const CONFIG_TEST_DEBOUNCE_MS = 800;

let aiModel = 'DeepSeek';

export function getConfig<T>(key: string): T | undefined {
    let configuration = workspace.getConfiguration(PREFIXCONFIG);
    return configuration.get<T>(key);
}

interface DeepSeekTranslateOption {
    authKey?: string;
    apiType?: 'openai' | 'ollama';
    apiBaseUrl?: string;
    model?: string;
}

export class DeepSeekTranslate implements ITranslate {
    get maxLen(): number {
        return 5000;
    }

    private _defaultOption: DeepSeekTranslateOption;
    private _configTestTimer: ReturnType<typeof setTimeout> | undefined;

    constructor() {
        this._defaultOption = this.createOption();
        workspace.onDidChangeConfiguration(eventNames => {
            if (eventNames.affectsConfiguration(PREFIXCONFIG)) {
                this._defaultOption = this.createOption();
                this.scheduleConnectionTest();
            }
        });
    }

    createOption(): DeepSeekTranslateOption {
        const defaultOption: DeepSeekTranslateOption = {
            authKey: getConfig<string>('authKey'),
            apiType: getConfig<'openai' | 'ollama'>('apiType') || 'openai',
            apiBaseUrl: getConfig<string>('apiBaseUrl') || DEFAULT_BASE_URL,
            model: getConfig<string>('model') || DEFAULT_MODEL,
        };
        return defaultOption;
    }

    async translate(content: string, { from = 'auto', to = 'auto' }: ITranslateOptions): Promise<string> {
        const option = this._defaultOption;

        if (!content.trim()) {
            return content;
        }
        if (!option.authKey && option.apiType !== 'ollama') {
            throw new Error('Please check the configuration of authKey!');
        }

        const expectedLines = countSourceLines(content);
        const messages = buildMessages(content, from, to, expectedLines);

        const first = await this.request(messages);
        if (expectedLines <= 1 || matchesLineCount(first, expectedLines)) {
            return normalizeTranslation(first, expectedLines);
        }

        // A merged or padded answer shifts every following comment line, so the
        // host extension throws the whole block away. One stricter retry is
        // cheaper than showing no translation at all.
        const retry = await this.request([
            ...messages,
            { role: 'user', content: buildRetryInstruction(expectedLines) },
        ]);
        const best = matchesLineCount(retry, expectedLines) ? retry : first;
        return normalizeTranslation(best, expectedLines);
    }

    private async request(messages: ChatMessage[]): Promise<string> {
        const option = this._defaultOption;
        const apiType = option.apiType === 'ollama' ? 'ollama' : 'openai';
        const baseUrl = (option.apiBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
        const url = apiType === 'ollama'
            ? `${baseUrl}/api/generate`
            : `${baseUrl}/chat/completions`;
        const model = option.model || DEFAULT_MODEL;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (apiType !== 'ollama') {
            headers.Authorization = `Bearer ${option.authKey}`;
        }

        // Ollama speaks its own generate API, everything else is OpenAI compatible.
        const body = apiType === 'ollama'
            ? {
                model,
                prompt: messages.map(message => message.content).join('\n\n'),
                stream: false,
            }
            : {
                model,
                // Deterministic output keeps the line structure stable.
                temperature: 0,
                messages,
                max_tokens: MAX_TOKENS,
                stream: false,
            };

        try {
            const res = await axios.post(url, body, { headers, timeout: REQUEST_TIMEOUT_MS });
            aiModel = res.data?.model || aiModel;

            const raw = apiType === 'ollama'
                ? res.data?.response
                : res.data?.choices?.[0]?.message?.content;

            if (typeof raw !== 'string' || !raw.trim()) {
                throw new Error('DeepSeek returned an empty translation.');
            }
            return raw;
        } catch (error) {
            if (error.response?.status === 401) {
                throw new Error('认证失败，请检查API Key是否正确');
            }
            throw error;
        }
    }

    link(content: string, { to = 'auto' }: ITranslateOptions) {
        if (content || to) { }
        return `[${aiModel ? aiModel : 'DeepSeek'}](https://platform.deepseek.com)`;
    }

    isSupported(src: string) {
        if (src) { }
        return true;
    }

    private scheduleConnectionTest() {
        if (this._configTestTimer) {
            clearTimeout(this._configTestTimer);
        }
        this._configTestTimer = setTimeout(() => {
            this._configTestTimer = undefined;
            void this.testConnection();
        }, CONFIG_TEST_DEBOUNCE_MS);
    }

    private async testConnection() {
        // 创建可销毁对象集合
        const disposables: Disposable[] = [];

        // 状态栏提示
        const progress = window.createStatusBarItem();
        progress.text = "$(sync~spin) [DeepSeek] API测试中...";
        progress.show();
        disposables.push(progress);

        // 超时提示管理
        let timeoutDisposable: Disposable | undefined;
        const timeoutTimer = setTimeout(() => {
            const disposable = window.showInformationMessage(
                "[DeepSeek] API测试进行中，请稍候..."
            );
            timeoutDisposable = { dispose: () => disposable.then(() => {}) };
            disposables.push(timeoutDisposable);
        }, 1000);

        try {
            const startTime = Date.now();
            const result = await this.translate('Hello', { to: 'zh-CN' });
            const elapsedTime = Date.now() - startTime;

            // 清除定时器和提示
            clearTimeout(timeoutTimer);
            if (timeoutDisposable) {
                timeoutDisposable.dispose();
            }

            if (!result.includes('你好')) {
                throw new Error('接口响应异常，请检查模型配置');
            }

            // 显示成功提示
            const successMsg = window.showInformationMessage(
                `[DeepSeek] API测试通过！响应时间：${elapsedTime}ms`,
                '查看详情'
            );

            successMsg.then(selection => {
                if (selection === '查看详情') {
                    window.showInformationMessage(`响应内容: ${result}`);
                }
            });
        } catch (error) {
            // 统一错误处理
            clearTimeout(timeoutTimer);
            let errorMessage = error.message;
            if (error.message && error.message.includes('401')) {
                errorMessage = '认证失败，请检查API Key是否正确';
            }
            window.showErrorMessage(`[DeepSeek] 配置测试失败: ${errorMessage}`);
        } finally {
            // 清理所有可销毁对象
            disposables.forEach(d => d.dispose());
        }
    }
}
