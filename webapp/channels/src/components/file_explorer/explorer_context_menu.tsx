// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

export type ContextMenuItem = {
    key: string;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    destructive?: boolean;

    /** Draw a separator above this item. */
    divider?: boolean;
};

type Props = {
    x: number;
    y: number;
    label: string;
    items: ContextMenuItem[];
    onClose: () => void;
};

/**
 * A menu that opens at the pointer (right-click or the context-menu key). The house MUI menus open
 * from a trigger button only, so this one positions itself and handles its own keys.
 */
const ExplorerContextMenu = ({x, y, label, items, onClose}: Props) => {
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({left: x, top: y});

    const buttons = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];

    useLayoutEffect(() => {
        const r = ref.current!.getBoundingClientRect();
        setPos({left: Math.max(0, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(0, Math.min(y, window.innerHeight - r.height - 4))});
        buttons()[0]?.focus();
    }, [x, y]);

    useEffect(() => {
        const opener = document.activeElement as HTMLElement | null;
        const onDown = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', onDown);
        window.addEventListener('blur', onClose);
        window.addEventListener('resize', onClose);
        return () => {
            document.removeEventListener('mousedown', onDown);
            window.removeEventListener('blur', onClose);
            window.removeEventListener('resize', onClose);
            opener?.focus?.();
        };
    }, [onClose]);

    const onKeyDown = (e: React.KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Escape' || e.key === 'Tab') {
            e.preventDefault();
            onClose();
            return;
        }
        const step = {ArrowDown: 1, ArrowUp: -1}[e.key];
        if (step) {
            e.preventDefault();
            const list = buttons();
            const i = list.indexOf(document.activeElement as HTMLButtonElement);
            list[(i + step + list.length) % list.length]?.focus();
        }
    };

    return createPortal(
        <div
            ref={ref}
            role='menu'
            tabIndex={-1}
            aria-label={label}
            className='ExplorerContextMenu'
            style={pos}
            onKeyDown={onKeyDown}
            onContextMenu={(e) => e.preventDefault()}
        >
            {items.map((item) => (
                <React.Fragment key={item.key}>
                    {item.divider && <div role='separator'/>}
                    <button
                        type='button'
                        role='menuitem'
                        className={classNames('ExplorerContextMenu__item', {destructive: item.destructive})}
                        disabled={item.disabled}
                        onClick={() => {
                            onClose();
                            item.onClick();
                        }}
                    >
                        {item.label}
                    </button>
                </React.Fragment>
            ))}
        </div>,
        document.body,
    );
};

export default ExplorerContextMenu;
