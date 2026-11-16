// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * @typedef {} Language
 */

import {getConfig} from 'mattermost-redux/selectors/entities/general';

import type {GlobalState} from 'types/store';

import {langFiles} from './imports';

export interface Language {
    value: string;
    name: string;
    order: number;
    url: string;
}

// should match the values in server/public/shared/i18n/i18n.go
export const languages = {
    en: {
        value: 'en',
        name: 'English (US)',
        order: 0,
        url: '',
    },
    tr: {
        value: 'tr',
        name: 'Türkçe',
        order: 1,
        url: langFiles.tr,
    },
};

export function getAllLanguages(): Record<string, Language> {
    return languages;
}

export function getLanguages(state: GlobalState) {
    const config = getConfig(state);
    if (!config.AvailableLocales) {
        return getAllLanguages();
    }
    return config.AvailableLocales.split(',').reduce<Record<string, Language>>((result, l) => {
        if (Object.hasOwn(languages, l)) {
            result[l] = languages[l as keyof typeof languages];
        }
        return result;
    }, {});
}

export function getLanguageInfo(locale: string) {
    return languages[locale as keyof typeof languages];
}

export function isLanguageAvailable(state: GlobalState, locale: string) {
    return Boolean(getLanguages(state)[locale]);
}
