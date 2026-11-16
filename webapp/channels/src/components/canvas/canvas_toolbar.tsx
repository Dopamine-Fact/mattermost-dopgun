// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import type {MessageDescriptor} from 'react-intl';
import {defineMessages, useIntl} from 'react-intl';

import {
    ArrowRightIcon,
    CheckboxBlankOutlineIcon,
    CircleOutlineIcon,
    FormatLetterCaseIcon,
    HandRightOutlineIcon,
    MinusIcon,
    PencilOutlineIcon,
} from '@mattermost/compass-icons/components';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';
import {WithTooltip} from '@mattermost/shared/components/tooltip';

export type Tool = 'select' | 'hand' | 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'eraser';

/** Stroke glyph for icons compass-icons lacks; Icon passes it a size. */
export function Glyph({d, size = 24}: {d: string; size?: number}) {
    return (
        <svg
            width={size}
            height={size}
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            strokeWidth={1.8}
            strokeLinecap='round'
            strokeLinejoin='round'
            aria-hidden={true}
        >
            <path d={d}/>
        </svg>
    );
}

const messages = defineMessages({
    toolbar: {id: 'canvas.toolbar', defaultMessage: 'Canvas tools'},
    select: {id: 'canvas.tool.select', defaultMessage: 'Select'},
    hand: {id: 'canvas.tool.hand', defaultMessage: 'Hand (pan)'},
    pen: {id: 'canvas.tool.pen', defaultMessage: 'Pen'},
    rect: {id: 'canvas.tool.rect', defaultMessage: 'Rectangle'},
    ellipse: {id: 'canvas.tool.ellipse', defaultMessage: 'Ellipse'},
    line: {id: 'canvas.tool.line', defaultMessage: 'Line'},
    arrow: {id: 'canvas.tool.arrow', defaultMessage: 'Arrow'},
    text: {id: 'canvas.tool.text', defaultMessage: 'Text'},
    eraser: {id: 'canvas.tool.eraser', defaultMessage: 'Eraser'},
});

/** In shortcut order: the letter and the position (1–9) both pick the tool. */
export const TOOLS: Array<{tool: Tool; key: string; label: MessageDescriptor; icon: React.ReactElement}> = [
    {tool: 'select', key: 'v', label: messages.select, icon: <Glyph d='M6 3l13 9.5-6 1.2L9.8 19.5z'/>},
    {tool: 'hand', key: 'h', label: messages.hand, icon: <HandRightOutlineIcon/>},
    {tool: 'pen', key: 'p', label: messages.pen, icon: <PencilOutlineIcon/>},
    {tool: 'rect', key: 'r', label: messages.rect, icon: <CheckboxBlankOutlineIcon/>},
    {tool: 'ellipse', key: 'o', label: messages.ellipse, icon: <CircleOutlineIcon/>},
    {tool: 'line', key: 'l', label: messages.line, icon: <MinusIcon/>},
    {tool: 'arrow', key: 'a', label: messages.arrow, icon: <ArrowRightIcon/>},
    {tool: 'text', key: 't', label: messages.text, icon: <FormatLetterCaseIcon/>},
    {tool: 'eraser', key: 'e', label: messages.eraser, icon: <Glyph d='M7 20h13M4.6 15.4l9.9-9.9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8.2zM9 11l5 5'/>},
];

// Keep focus on the board so its shortcuts (and Space to pan) keep working after a click.
export const keepFocus = (e: React.MouseEvent) => e.preventDefault();

type Props = {
    tool: Tool;
    readOnly: boolean;
    onSelect: (tool: Tool) => void;
};

export default function CanvasToolbar({tool, readOnly, onSelect}: Props) {
    const {formatMessage} = useIntl();
    const tools = readOnly ? TOOLS.filter((t) => t.tool === 'hand') : TOOLS;

    return (
        <div
            className='CanvasBoard__toolbar'
            role='toolbar'
            aria-label={formatMessage(messages.toolbar)}
        >
            {tools.map((t) => (
                <span
                    key={t.tool}
                    className='CanvasBoard__toolSlot'
                >
                    <WithTooltip
                        title={formatMessage(t.label)}
                        shortcut={{default: [t.key.toUpperCase()]}}
                    >
                        <IconButton
                            size='small'
                            toggled={tool === t.tool}
                            aria-label={formatMessage(t.label)}
                            icon={<Icon glyph={t.icon}/>}
                            onMouseDown={keepFocus}
                            onClick={() => onSelect(t.tool)}
                        />
                    </WithTooltip>
                    <span
                        className='CanvasBoard__key'
                        aria-hidden={true}
                    >
                        {TOOLS.indexOf(t) + 1}
                    </span>
                </span>
            ))}
        </div>
    );
}
