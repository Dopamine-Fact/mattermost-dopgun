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

export type Tool = 'select' | 'hand' | 'pen' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'eraser' | 'frame';

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
    frame: {id: 'canvas.tool.frame', defaultMessage: 'Frame'},
    frameSizes: {id: 'canvas.frame.sizes', defaultMessage: 'Frame size'},
    custom: {id: 'canvas.frame.custom', defaultMessage: 'Custom'},
    a4: {id: 'canvas.frame.a4', defaultMessage: 'A4'},
    letter: {id: 'canvas.frame.letter', defaultMessage: 'Letter'},
    mobile: {id: 'canvas.frame.mobile', defaultMessage: 'Mobile'},
    tablet: {id: 'canvas.frame.tablet', defaultMessage: 'Tablet'},
    desktop: {id: 'canvas.frame.desktop', defaultMessage: 'Desktop'},
});

export type FramePreset = {label: MessageDescriptor | string; w: number; h: number};

/** Custom (no size) draws by dragging; the others are placed by a click, centred on it. */
export const FRAME_PRESETS: FramePreset[] = [
    {label: messages.custom, w: 0, h: 0},
    {label: messages.a4, w: 595, h: 842},
    {label: messages.letter, w: 612, h: 792},
    {label: '16:9', w: 1280, h: 720},
    {label: '4:3', w: 1024, h: 768},
    {label: '1:1', w: 1024, h: 1024},
    {label: messages.mobile, w: 390, h: 844},
    {label: messages.tablet, w: 834, h: 1194},
    {label: messages.desktop, w: 1440, h: 1024},
];

export const FRAME_LABEL = messages.frame;

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
    {tool: 'frame', key: 'f', label: messages.frame, icon: <Glyph d='M7 3v18M17 3v18M3 7h18M3 17h18'/>},
];

// Keep focus on the board so its shortcuts (and Space to pan) keep working after a click.
export const keepFocus = (e: React.MouseEvent) => e.preventDefault();

type Props = {
    tool: Tool;
    readOnly: boolean;
    onSelect: (tool: Tool) => void;
    framePreset: FramePreset;
    onFramePreset: (preset: FramePreset) => void;
};

export default function CanvasToolbar({tool, readOnly, onSelect, framePreset, onFramePreset}: Props) {
    const {formatMessage} = useIntl();
    const tools = readOnly ? TOOLS.filter((t) => t.tool === 'hand') : TOOLS;
    const text = (label: FramePreset['label']) => (typeof label === 'string' ? label : formatMessage(label));

    return (
        <>
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
                        {TOOLS.indexOf(t) < 9 && ( // digits 1–9 only
                            <span
                                className='CanvasBoard__key'
                                aria-hidden={true}
                            >
                                {TOOLS.indexOf(t) + 1}
                            </span>
                        )}
                    </span>
                ))}
            </div>
            {tool === 'frame' && !readOnly && (
                <div
                    className='CanvasBoard__frames'
                    role='group'
                    aria-label={formatMessage(messages.frameSizes)}
                >
                    {FRAME_PRESETS.map((p) => (
                        <button
                            key={text(p.label)}
                            type='button'
                            className='CanvasBoard__propsButton'
                            aria-pressed={p === framePreset}
                            onMouseDown={keepFocus}
                            onClick={() => onFramePreset(p)}
                        >
                            {text(p.label)}
                            {p.w > 0 && <span className='CanvasBoard__frameSize'>{`${p.w}×${p.h}`}</span>}
                        </button>
                    ))}
                </div>
            )}
        </>
    );
}
