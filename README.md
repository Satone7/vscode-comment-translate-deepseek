# deepseek-translate README

The plugin provides a translation source for the 'comment-translate' plugin. Itself does not activate, it starts when enabled is selected.

## Features

1. Provide translation capabilities
2. Provides online document link text

## Requirements

Please install '[comment-translate](https://github.com/intellism/vscode-comment-translate)' to use

## Use
1. After installation, call the "Change translation source" command of "Comment Translate"
    ![change](./image/change.png)
2. Check "deepseek translate" to configure the plugin API Key
    ![select](./image/select.png)
3. Directly use the "Comment Translate" interactive mode to translate the corresponding text

## Extension Settings

This extension contributes the following settings:

* `deepseekTranslate.authKey`: Authentication key for DeepSeek API (required for cloud API)
* `deepseekTranslate.apiType`: API type selection `openai`(default)/`ollama` (for local deployment)
* `deepseekTranslate.apiBaseUrl`: API base address (default: `https://api.deepseek.com`, Ollama users set to `http://localhost:11434`)
* `deepseekTranslate.model`: Model name (default: `deepseek-chat`, Ollama users set local model name)

## Configuration Examples

### For Cloud API (Default)
```json
{
    "deepseekTranslate.authKey": "your_api_key_here",
    "deepseekTranslate.apiType": "openai",
    "deepseekTranslate.model": "deepseek-chat"
}
```

### For Local Ollama
```json
{
    "deepseekTranslate.apiType": "ollama",
    "deepseekTranslate.apiBaseUrl": "http://localhost:11434",
    "deepseekTranslate.model": "your_local_model_name"
}
```

### For Custom OpenAI-Compatible API
```json
{
    "deepseekTranslate.authKey": "your_custom_api_key",
    "deepseekTranslate.apiType": "openai",
    "deepseekTranslate.apiBaseUrl": "https://your.custom.api/v1",
    "deepseekTranslate.model": "your-custom-model"
}
```

## Notice

1. When using Ollama mode:
   - Requires local deployment of [Ollama](https://ollama.ai/)
   - No need to configure authKey
   - Model name should match local installed models
2. Cloud API users must configure valid authKey
