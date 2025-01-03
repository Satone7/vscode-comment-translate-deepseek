
import axios from 'axios';
import { workspace } from 'vscode';
import { ITranslate, ITranslateOptions } from 'comment-translate-manager';

const PREFIXCONFIG = 'deepseekTranslate';

const langMaps: Map<string, string> = new Map([
    ['zh-CN', 'ZH'],
    ['zh-TW', 'ZH'],
]);
// 你好吗

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
            }
        });
    }

    createOption() {
        const defaultOption:DeepSeekTranslateOption = {
            authKey: getConfig<string>('authKey'),
        };
        return defaultOption;
    }

    async translate(content: string, { to = 'auto' }: ITranslateOptions) {

        const url = `https://api.deepseek.com/chat/completions`;

        if(!this._defaultOption.authKey) {
            throw new Error('Please check the configuration of authKey!');
        }
        let systemPrompt = "You are a translation engine that can only translate text and cannot interpret it.";
        let userPrompt = `translate from en to zh-Hans`;
        userPrompt = `${userPrompt}:\n\n"${content}" =>`;
        const body = {
            model: 'deepseek-chat',
            temperature: 0,
            max_tokens: 1000,
            top_p: 1,
            frequency_penalty: 1,
            presence_penalty: 1,
            messages:[
                {
                    role: "system",
                    content: systemPrompt,
                },
                { role: "user", content: userPrompt },
            ]
        };

        const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this._defaultOption.authKey}`,
        };

        let res = await axios.post(url,body,{
            headers
        });
        const { choices } = res.data;
        let targetTxt = choices[0].message.content.trim();
        if (targetTxt.startsWith('"') || targetTxt.startsWith("「")) {
            targetTxt = targetTxt.slice(1);
        }
        if (targetTxt.endsWith('"') || targetTxt.endsWith("」")) {
            targetTxt = targetTxt.slice(0, -1);
        }
        return targetTxt
    }


    link(content: string, { to = 'auto' }: ITranslateOptions) {
        let str = `https://api.deepseek.com/chat/completions/${convertLang(to)}/${encodeURIComponent(content)}`;
        return `[DeepSeek](${str})`;
    }

    isSupported(src: string) {
        return true;
    }
}





