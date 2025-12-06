import prompt from 'custom-electron-prompt';

import { createPlugin } from '@/utils';
import promptOptions from '@/providers/prompt-options';

import { backend } from './main';

/**
 * Configuration interface for the Last.fm plugin.
 */
export interface LastFmConfig {
    enabled: boolean;
    token?: string; // Request token for authentication
    sessionKey?: string; // Session key obtained after user approval
    apiRoot: string; // Base URL for Last.fm API
    apiKey: string; // Application API Key
    secret: string; // Application API Secret
}

/**
 * Default configuration values.
 * Includes a default API Key and Secret for immediate use.
 */
export const defaultConfig: LastFmConfig = {
    enabled: false,
    apiRoot: 'https://ws.audioscrobbler.com/2.0/',
    apiKey: '04d76faaac8726e60988e14c105d421a',
    secret: 'a5d2a36fdf64819290f6982481eaffa2',
};

export default createPlugin({
    name: () => 'Last.fm',
    description: () => 'Scrobble your music to Last.fm',
    restartNeeded: true,
    config: defaultConfig,
    menu: async ({ getConfig, setConfig, window }) => {
        const config = await getConfig();
        return [
            {
                label: 'Last.fm API Settings',
                async click() {
                    const output = await prompt(
                        {
                            title: 'Last.fm API Settings',
                            label: 'Configure API Key and Secret',
                            type: 'multiInput',
                            multiInputOptions: [
                                {
                                    label: 'API Key',
                                    value: config.apiKey,
                                    inputAttrs: {
                                        type: 'text',
                                    },
                                },
                                {
                                    label: 'API Secret',
                                    value: config.secret,
                                    inputAttrs: {
                                        type: 'text',
                                    },
                                },
                            ],
                            resizable: true,
                            height: 360,
                            ...promptOptions(),
                        },
                        window,
                    );

                    if (output) {
                        if (output[0]) {
                            setConfig({ apiKey: output[0] });
                        }
                        if (output[1]) {
                            setConfig({ secret: output[1] });
                        }
                    }
                },
            },
        ];
    },
    backend,
});
