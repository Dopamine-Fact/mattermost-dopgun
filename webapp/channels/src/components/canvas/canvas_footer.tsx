// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {defineMessages, useIntl} from 'react-intl';

import {MinusIcon, PlusIcon} from '@mattermost/compass-icons/components';
import {Button} from '@mattermost/compass-ui/components/button';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';
import {ShortcutKeys} from '@mattermost/shared/components/shortcut_key';
import {WithTooltip} from '@mattermost/shared/components/tooltip';

import {Glyph, keepFocus} from './canvas_toolbar';

const messages = defineMessages({
    zoomOut: {id: 'canvas.zoomOut', defaultMessage: 'Zoom out'},
    zoomIn: {id: 'canvas.zoomIn', defaultMessage: 'Zoom in'},
    zoomReset: {id: 'canvas.zoomReset', defaultMessage: 'Reset zoom'},
    undo: {id: 'canvas.undo', defaultMessage: 'Undo'},
    redo: {id: 'canvas.redo', defaultMessage: 'Redo'},
});

const ctrl = (key: string) => ({default: [ShortcutKeys.ctrl, key], mac: [ShortcutKeys.cmd, key]});

type Props = {
    zoom: number;
    readOnly: boolean;
    canUndo: boolean;
    canRedo: boolean;
    onZoomOut: () => void;
    onZoomIn: () => void;
    onZoomReset: () => void;
    onUndo: () => void;
    onRedo: () => void;
};

export default function CanvasFooter(props: Props) {
    const {formatMessage, formatNumber} = useIntl();

    return (
        <div className='CanvasBoard__footer'>
            <div className='CanvasBoard__group'>
                <WithTooltip
                    title={formatMessage(messages.zoomOut)}
                    shortcut={ctrl('-')}
                >
                    <IconButton
                        size='small'
                        aria-label={formatMessage(messages.zoomOut)}
                        icon={<Icon glyph={<MinusIcon/>}/>}
                        onMouseDown={keepFocus}
                        onClick={props.onZoomOut}
                    />
                </WithTooltip>
                <WithTooltip
                    title={formatMessage(messages.zoomReset)}
                    shortcut={ctrl('0')}
                >
                    <Button
                        size='small'
                        emphasis='quaternary'
                        className='CanvasBoard__zoom'
                        onMouseDown={keepFocus}
                        onClick={props.onZoomReset}
                    >
                        {formatNumber(props.zoom, {style: 'percent', maximumFractionDigits: 0})}
                    </Button>
                </WithTooltip>
                <WithTooltip
                    title={formatMessage(messages.zoomIn)}
                    shortcut={ctrl('=')}
                >
                    <IconButton
                        size='small'
                        aria-label={formatMessage(messages.zoomIn)}
                        icon={<Icon glyph={<PlusIcon/>}/>}
                        onMouseDown={keepFocus}
                        onClick={props.onZoomIn}
                    />
                </WithTooltip>
            </div>
            {!props.readOnly && (
                <div className='CanvasBoard__group'>
                    <WithTooltip
                        title={formatMessage(messages.undo)}
                        shortcut={ctrl('Z')}
                    >
                        <IconButton
                            size='small'
                            aria-label={formatMessage(messages.undo)}
                            icon={<Icon glyph={<Glyph d='M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11'/>}/>}
                            disabled={!props.canUndo}
                            onMouseDown={keepFocus}
                            onClick={props.onUndo}
                        />
                    </WithTooltip>
                    <WithTooltip
                        title={formatMessage(messages.redo)}
                        shortcut={ctrl('Y')}
                    >
                        <IconButton
                            size='small'
                            aria-label={formatMessage(messages.redo)}
                            icon={<Icon glyph={<Glyph d='M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13'/>}/>}
                            disabled={!props.canRedo}
                            onMouseDown={keepFocus}
                            onClick={props.onRedo}
                        />
                    </WithTooltip>
                </div>
            )}
        </div>
    );
}
