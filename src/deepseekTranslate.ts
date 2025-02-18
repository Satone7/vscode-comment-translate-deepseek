import axios from 'axios';
import { workspace, window, Disposable } from 'vscode';
import { ITranslate, ITranslateOptions } from 'comment-translate-manager';

const PREFIXCONFIG = 'deepseekTranslate';

const langMaps: Map<string, string> = new Map([
    ['zh-CN', 'ZH'],
    ['zh-TW', 'ZH'],
]);
// 你好吗

let aiModel = 'DeepSeek';

function convertLang(src: string) {
    if (langMaps.has(src)) {
        return langMaps.get(src);
    }
    return src.toLocaleUpperCase();
}

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
    constructor() {
        this._defaultOption = this.createOption();
        workspace.onDidChangeConfiguration(async eventNames => {
            if (eventNames.affectsConfiguration(PREFIXCONFIG)) {
                this._defaultOption = this.createOption();
                try {
                    await this.testConnection();
                } catch (error) {
                    window.showErrorMessage(`配置测试失败: ${error.message}`);
                }
            }
        });
    }

    createOption() {
        const defaultOption:DeepSeekTranslateOption = {
            authKey: getConfig<string>('authKey'),
            apiType: getConfig<'openai' | 'ollama'>('apiType') || 'openai',
            apiBaseUrl: getConfig<string>('apiBaseUrl') || 'https://api.deepseek.com',
            model: getConfig<string>('model') || 'deepseek-chat',
        };
        return defaultOption;
    }

    async translate(content: string, { to = 'auto' }: ITranslateOptions) {
        const baseUrl = this._defaultOption.apiBaseUrl;
        const apiType = this._defaultOption.apiType;
        const url = apiType === 'ollama'
            ? `${baseUrl}/api/generate`
            : `${baseUrl}/chat/completions`;

        if(!this._defaultOption.authKey && apiType !== 'ollama') {
            throw new Error('Please check the configuration of authKey!');
        }

        const messages = [
            { role: "system", content: "You are a translation engine that can only translate text and cannot interpret it." },
            { role: "user", content: `translate from en to zh-Hans:\n\n"${content}" =>` }
        ];

        const body = apiType === 'ollama' ? {
            model: this._defaultOption.model || 'deepseek-chat',
            prompt: `${messages[0].content}\n${messages[1].content}`,
            stream: false
        } : {
            model: this._defaultOption.model || 'deepseek-chat',
            temperature: 0,
            messages,
            max_tokens: 1000,
            top_p: 1,
            frequency_penalty: 1,
            presence_penalty: 1,
        };

        const headers = apiType === 'ollama' ? {
            "Content-Type": "application/json"
        } : {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this._defaultOption.authKey}`
        };

        try {
            let res = await axios.post(url, body, { headers });
            let targetTxt = apiType === 'ollama'
                ? res.data.response.trim()
                : res.data.choices[0].message.content.trim();
            aiModel = res.data.model;
            if (targetTxt.startsWith('"') || targetTxt.startsWith("「")) {
                targetTxt = targetTxt.slice(1);
            }
            if (targetTxt.endsWith('"') || targetTxt.endsWith("」")) {
                targetTxt = targetTxt.slice(0, -1);
            }
            return targetTxt
        } catch (error) {
            if (error.response?.status === 401) {
                throw new Error('认证失败，请检查API Key是否正确');
            }
            throw error;
        }
    }

    link(content: string, { to = 'auto' }: ITranslateOptions) {
        const baseUrl = this._defaultOption.apiBaseUrl;
        const apiType = this._defaultOption.apiType;
        const url = apiType === 'ollama'
            ? `${baseUrl}/api/generate`
            : `${baseUrl}/chat/completions`;
        return `[${aiModel?aiModel:'DeepSeek'}](${url})`;
    }

    isSupported(src: string) {
        return true;
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
            const result = await this.translate('Hello', { to: 'zh-Hans' });
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
            if (error.message.includes('401')) {
                errorMessage = '认证失败，请检查API Key是否正确';
            }
            window.showErrorMessage(`[DeepSeek] 配置测试失败: ${errorMessage}`);
        } finally {
            // 清理所有可销毁对象
            disposables.forEach(d => d.dispose());
        }
    }
}





