// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useRef} from 'react';
import {useIntl} from 'react-intl';

type Props = {
    name: string;

    /** Select only the part before the extension, as Windows does for files. */
    keepExtension: boolean;

    /** The trimmed new name, or undefined when cancelled. */
    onDone: (name?: string) => void;
};

const ExplorerRenameInput = ({name, keepExtension, onDone}: Props) => {
    const intl = useIntl();
    const ref = useRef<HTMLInputElement>(null);
    const done = useRef(false);

    useEffect(() => {
        const dot = keepExtension ? name.lastIndexOf('.') : -1;
        ref.current?.focus();
        ref.current?.setSelectionRange(0, dot > 0 ? dot : name.length);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- select once, when the box opens

    const finish = (value?: string) => {
        if (!done.current) {
            done.current = true;
            onDone(value);
        }
    };
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    return (
        <input
            ref={ref}
            className='ExplorerRenameInput form-control'
            aria-label={intl.formatMessage({id: 'file_explorer.column.name', defaultMessage: 'Name'})}
            defaultValue={name}
            maxLength={255}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                    e.preventDefault();
                    finish(e.currentTarget.value.trim());
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    finish();
                }
            }}
            onBlur={(e) => finish(e.currentTarget.value.trim())}
            onClick={stop}
            onDoubleClick={stop}
            onMouseDown={stop}
        />
    );
};

export default ExplorerRenameInput;
