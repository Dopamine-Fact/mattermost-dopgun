// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

type Props = {
    value: string;
    onSave: (value: string) => void;
    multiline?: boolean;
    allowEmpty?: boolean;
    className?: string;
    placeholder?: string;
    'aria-label': string;
    maxLength?: number;
};

// BlurInput saves on blur (or Enter for single-line); keying on value resets it when the server copy changes.
const BlurInput = ({value, onSave, multiline, allowEmpty, ...rest}: Props) => {
    const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const next = multiline ? e.target.value : e.target.value.trim();
        if (next === value) {
            return;
        }
        if (!next && !allowEmpty) {
            e.target.value = value;
            return;
        }
        onSave(next);
    };

    if (multiline) {
        return (
            <textarea
                key={value}
                defaultValue={value}
                onBlur={handleBlur}
                {...rest}
            />
        );
    }

    return (
        <input
            key={value}
            type='text'
            defaultValue={value}
            onBlur={handleBlur}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.currentTarget.blur();
                } else if (e.key === 'Escape') {
                    e.currentTarget.value = value;
                    e.currentTarget.blur();
                }
            }}
            {...rest}
        />
    );
};

export default BlurInput;
