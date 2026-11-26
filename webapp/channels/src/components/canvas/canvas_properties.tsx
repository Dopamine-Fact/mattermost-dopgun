// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import type {MessageDescriptor} from 'react-intl';
import {defineMessages, useIntl} from 'react-intl';

import type {UserProfile} from '@mattermost/types/users';

import Timestamp from 'components/timestamp';

import {keepFocus} from './canvas_toolbar';
import type {AlignMode} from './geometry';
import {DEFAULT_STYLE} from './model';
import type {ElementStyle, ElementType} from './model';

export type PanelAction = 'duplicate' | 'delete' | 'back' | 'backward' | 'forward' | 'front' | AlignMode;

/** Stored in the doc, so these values are fixed. The first stroke preset is the default stroke. */
export const STROKE_COLORS = [DEFAULT_STYLE.stroke, '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5'];
export const FILL_COLORS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99', '#eebefa'];

const SHAPES: ElementType[] = ['rect', 'ellipse'];
const LINES: ElementType[] = ['line', 'arrow'];

const messages = defineMessages({
    panel: {id: 'canvas.props.panel', defaultMessage: 'Properties', description: 'Label of the canvas side panel that edits the style of the selected elements or of the next element drawn'},
    stroke: {id: 'canvas.props.stroke', defaultMessage: 'Stroke', description: 'Canvas properties: colour of lines and text'},
    background: {id: 'canvas.props.background', defaultMessage: 'Background', description: 'Canvas properties: fill colour of a rectangle or ellipse'},
    transparent: {id: 'canvas.props.transparent', defaultMessage: 'Transparent', description: 'Canvas properties: the no-fill background option'},
    customColor: {id: 'canvas.props.customColor', defaultMessage: 'Custom colour', description: 'Canvas properties: opens the browser colour picker'},
    fillStyle: {id: 'canvas.props.fillStyle', defaultMessage: 'Fill', description: 'Canvas properties: how the background of a shape is painted'},
    solid: {id: 'canvas.props.solid', defaultMessage: 'Solid', description: 'Canvas properties: solid fill or solid stroke option'},
    hachure: {id: 'canvas.props.hachure', defaultMessage: 'Hachure', description: 'Canvas properties: fill with parallel hand-drawn lines'},
    crossHatch: {id: 'canvas.props.crossHatch', defaultMessage: 'Cross-hatch', description: 'Canvas properties: fill with crossing hand-drawn lines'},
    strokeWidth: {id: 'canvas.props.strokeWidth', defaultMessage: 'Stroke width', description: 'Canvas properties: thickness of lines'},
    thin: {id: 'canvas.props.thin', defaultMessage: 'Thin', description: 'Canvas properties: thinnest stroke width'},
    bold: {id: 'canvas.props.bold', defaultMessage: 'Bold', description: 'Canvas properties: medium stroke width'},
    extraBold: {id: 'canvas.props.extraBold', defaultMessage: 'Extra bold', description: 'Canvas properties: thickest stroke width'},
    strokeStyle: {id: 'canvas.props.strokeStyle', defaultMessage: 'Stroke style', description: 'Canvas properties: solid, dashed or dotted lines'},
    dashed: {id: 'canvas.props.dashed', defaultMessage: 'Dashed', description: 'Canvas properties: dashed stroke option'},
    dotted: {id: 'canvas.props.dotted', defaultMessage: 'Dotted', description: 'Canvas properties: dotted stroke option'},
    sloppiness: {id: 'canvas.props.sloppiness', defaultMessage: 'Sloppiness', description: 'Canvas properties: how hand-drawn shapes look'},
    architect: {id: 'canvas.props.architect', defaultMessage: 'Architect', description: 'Canvas properties: precise, straight sloppiness option'},
    artist: {id: 'canvas.props.artist', defaultMessage: 'Artist', description: 'Canvas properties: slightly hand-drawn sloppiness option'},
    cartoonist: {id: 'canvas.props.cartoonist', defaultMessage: 'Cartoonist', description: 'Canvas properties: very hand-drawn sloppiness option'},
    edges: {id: 'canvas.props.edges', defaultMessage: 'Edges', description: 'Canvas properties: corners of a rectangle'},
    sharp: {id: 'canvas.props.sharp', defaultMessage: 'Sharp', description: 'Canvas properties: square corners option'},
    round: {id: 'canvas.props.round', defaultMessage: 'Round', description: 'Canvas properties: rounded corners option'},
    startArrow: {id: 'canvas.props.startArrow', defaultMessage: 'Start arrowhead', description: 'Canvas properties: head at the start of a line or arrow'},
    endArrow: {id: 'canvas.props.endArrow', defaultMessage: 'End arrowhead', description: 'Canvas properties: head at the end of a line or arrow'},
    headNone: {id: 'canvas.props.headNone', defaultMessage: 'None', description: 'Canvas properties: no arrowhead option'},
    headArrow: {id: 'canvas.props.headArrow', defaultMessage: 'Arrow', description: 'Canvas properties: open arrowhead option'},
    headTriangle: {id: 'canvas.props.headTriangle', defaultMessage: 'Triangle', description: 'Canvas properties: filled triangle arrowhead option'},
    headBar: {id: 'canvas.props.headBar', defaultMessage: 'Bar', description: 'Canvas properties: flat bar arrowhead option'},
    fontSize: {id: 'canvas.props.fontSize', defaultMessage: 'Font size', description: 'Canvas properties: size of text'},
    small: {id: 'canvas.props.small', defaultMessage: 'Small', description: 'Canvas properties: smallest font size'},
    medium: {id: 'canvas.props.medium', defaultMessage: 'Medium', description: 'Canvas properties: medium font size'},
    large: {id: 'canvas.props.large', defaultMessage: 'Large', description: 'Canvas properties: large font size'},
    extraLarge: {id: 'canvas.props.extraLarge', defaultMessage: 'Extra large', description: 'Canvas properties: largest font size'},
    fontFamily: {id: 'canvas.props.fontFamily', defaultMessage: 'Font', description: 'Canvas properties: typeface of text'},
    fontNormal: {id: 'canvas.props.fontNormal', defaultMessage: 'Normal', description: 'Canvas properties: regular typeface option'},
    fontCode: {id: 'canvas.props.fontCode', defaultMessage: 'Code', description: 'Canvas properties: monospace typeface option'},
    textAlign: {id: 'canvas.props.textAlign', defaultMessage: 'Text align', description: 'Canvas properties: horizontal alignment of text inside its box'},
    textLeft: {id: 'canvas.props.textLeft', defaultMessage: 'Left', description: 'Canvas properties: left-aligned text option'},
    textCenter: {id: 'canvas.props.textCenter', defaultMessage: 'Center', description: 'Canvas properties: centred text option'},
    textRight: {id: 'canvas.props.textRight', defaultMessage: 'Right', description: 'Canvas properties: right-aligned text option'},
    opacity: {id: 'canvas.props.opacity', defaultMessage: 'Opacity', description: 'Canvas properties: slider for how see-through elements are'},
    layers: {id: 'canvas.props.layers', defaultMessage: 'Layers', description: 'Canvas properties: group of buttons that change the stacking order of the selected elements'},
    toBack: {id: 'canvas.props.toBack', defaultMessage: 'Send to back', description: 'Move the selected elements behind all others'},
    backward: {id: 'canvas.props.backward', defaultMessage: 'Send backward', description: 'Move the selected elements one step back'},
    forward: {id: 'canvas.props.forward', defaultMessage: 'Bring forward', description: 'Move the selected elements one step forward'},
    toFront: {id: 'canvas.props.toFront', defaultMessage: 'Bring to front', description: 'Move the selected elements in front of all others'},
    align: {id: 'canvas.props.align', defaultMessage: 'Align', description: 'Canvas properties: group of buttons that align the selected elements with each other'},
    alignLeft: {id: 'canvas.props.alignLeft', defaultMessage: 'Align left', description: 'Line up the left edges of the selected elements'},
    alignCenter: {id: 'canvas.props.alignCenter', defaultMessage: 'Align center', description: 'Line up the horizontal centres of the selected elements'},
    alignRight: {id: 'canvas.props.alignRight', defaultMessage: 'Align right', description: 'Line up the right edges of the selected elements'},
    alignTop: {id: 'canvas.props.alignTop', defaultMessage: 'Align top', description: 'Line up the top edges of the selected elements'},
    alignMiddle: {id: 'canvas.props.alignMiddle', defaultMessage: 'Align middle', description: 'Line up the vertical centres of the selected elements'},
    alignBottom: {id: 'canvas.props.alignBottom', defaultMessage: 'Align bottom', description: 'Line up the bottom edges of the selected elements'},
    actions: {id: 'canvas.props.actions', defaultMessage: 'Actions', description: 'Canvas properties: group of buttons that act on the selected elements'},
    duplicate: {id: 'canvas.props.duplicate', defaultMessage: 'Duplicate', description: 'Copy the selected elements'},
    owner: {id: 'canvas.properties.owner', defaultMessage: 'Owner', description: 'Canvas properties: the person responsible for the selected storyboard card'},
    noOwner: {id: 'canvas.properties.noOwner', defaultMessage: 'None', description: 'Canvas properties: owner option meaning the storyboard card has no owner'},
    done: {id: 'canvas.properties.done', defaultMessage: 'Done', description: 'Canvas properties: marks the selected storyboard card as finished'},
    frame: {id: 'canvas.properties.frame', defaultMessage: 'Frame colour', description: 'Canvas properties: colour of a storyboard card frame, used when the card has no owner'},
    created: {id: 'canvas.properties.created', defaultMessage: 'Created by {name} · {date}', description: 'Canvas properties: who created the selected element and when; {name} is a username, {date} a date and time'},
    edited: {id: 'canvas.properties.edited', defaultMessage: 'Last edited by {name} · {date}', description: 'Canvas properties: who last changed the selected element and when; {name} is a username, {date} a date and time'},
    uploaded: {id: 'canvas.properties.uploaded', defaultMessage: 'Uploaded by {name}', description: 'Canvas properties: the username of the person who uploaded the selected image'},
    delete: {id: 'canvas.props.delete', defaultMessage: 'Delete', description: 'Remove the selected elements'},
});

type Option<V> = {value: V; label: MessageDescriptor};

const WIDTHS: Array<Option<ElementStyle['strokeWidth']>> = [{value: 1, label: messages.thin}, {value: 2, label: messages.bold}, {value: 4, label: messages.extraBold}];
const STROKE_STYLES: Array<Option<ElementStyle['strokeStyle']>> = [{value: 'solid', label: messages.solid}, {value: 'dashed', label: messages.dashed}, {value: 'dotted', label: messages.dotted}];
const ROUGHNESS: Array<Option<ElementStyle['roughness']>> = [{value: 0, label: messages.architect}, {value: 1, label: messages.artist}, {value: 2, label: messages.cartoonist}];
const FILL_STYLES: Array<Option<ElementStyle['fillStyle']>> = [{value: 'solid', label: messages.solid}, {value: 'hachure', label: messages.hachure}, {value: 'cross-hatch', label: messages.crossHatch}];
const EDGES: Array<Option<ElementStyle['roundness']>> = [{value: 'sharp', label: messages.sharp}, {value: 'round', label: messages.round}];
const HEADS: Array<Option<ElementStyle['endArrow']>> = [{value: 'none', label: messages.headNone}, {value: 'arrow', label: messages.headArrow}, {value: 'triangle', label: messages.headTriangle}, {value: 'bar', label: messages.headBar}];
const FONT_SIZES: Array<Option<ElementStyle['fontSize']>> = [{value: 16, label: messages.small}, {value: 20, label: messages.medium}, {value: 28, label: messages.large}, {value: 36, label: messages.extraLarge}];
const FONTS: Array<Option<ElementStyle['fontFamily']>> = [{value: 'normal', label: messages.fontNormal}, {value: 'code', label: messages.fontCode}];
const TEXT_ALIGNS: Array<Option<ElementStyle['textAlign']>> = [{value: 'left', label: messages.textLeft}, {value: 'center', label: messages.textCenter}, {value: 'right', label: messages.textRight}];
const ALIGNS: Array<Option<PanelAction>> = [
    {value: 'left', label: messages.alignLeft}, {value: 'center', label: messages.alignCenter}, {value: 'right', label: messages.alignRight},
    {value: 'top', label: messages.alignTop}, {value: 'middle', label: messages.alignMiddle}, {value: 'bottom', label: messages.alignBottom},
];
const LAYERS: Array<Option<PanelAction>> = [{value: 'back', label: messages.toBack}, {value: 'backward', label: messages.backward}, {value: 'forward', label: messages.forward}, {value: 'front', label: messages.toFront}];
const ACTIONS: Array<Option<PanelAction>> = [{value: 'duplicate', label: messages.duplicate}, {value: 'delete', label: messages.delete}];

type Props = {
    types: ElementType[];
    values: Partial<ElementStyle>;

    /** live is true while a slider or colour picker is still being dragged */
    onChange: (patch: Partial<ElementStyle>, live?: boolean) => void;
    onCommit?: () => void;
    onAction: (a: PanelAction) => void;
    selectionCount: number;

    /** Read-only users get the info, owner name and done state as text, with no controls. */
    readOnly?: boolean;

    /** Names are already resolved; shown only when one element is selected. */
    info?: {createdBy?: string; createdAt?: number; updatedBy?: string; updatedAt?: number; uploadedBy?: string};
    scene?: {ownerId?: string; ownerName?: string; done: boolean; members: UserProfile[]};

    /** ownerId undefined means "none" */
    onSceneChange?: (patch: {ownerId?: string; done?: boolean}) => void;
};

function Info({info}: {info: NonNullable<Props['info']>}) {
    const {formatMessage} = useIntl();
    const date = (t: number) => (
        <Timestamp
            value={t}
            useRelative={false}
        />
    );
    return (
        <div className='CanvasBoard__propsSection CanvasBoard__propsInfo'>
            {info.createdBy && info.createdAt !== undefined && <div>{formatMessage(messages.created, {name: info.createdBy, date: date(info.createdAt)})}</div>}
            {info.updatedBy && info.updatedAt !== undefined && <div>{formatMessage(messages.edited, {name: info.updatedBy, date: date(info.updatedAt)})}</div>}
            {info.uploadedBy && <div>{formatMessage(messages.uploaded, {name: info.uploadedBy})}</div>}
        </div>
    );
}

function SceneFields({scene, readOnly, onSceneChange}: {scene: NonNullable<Props['scene']>; readOnly?: boolean; onSceneChange?: Props['onSceneChange']}) {
    const {formatMessage} = useIntl();
    const {ownerId, ownerName, done, members} = scene;
    if (readOnly) {
        return (
            <div className='CanvasBoard__propsSection CanvasBoard__propsInfo'>
                {ownerId && (
                    <>
                        <div className='CanvasBoard__propsLabel'>{formatMessage(messages.owner)}</div>
                        <div>{ownerName ?? ownerId}</div>
                    </>
                )}
                {done && <div>{formatMessage(messages.done)}</div>}
            </div>
        );
    }
    return (
        <div className='CanvasBoard__propsSection'>
            <label className='CanvasBoard__propsLabel'>
                {formatMessage(messages.owner)}
                <select
                    className='form-control'
                    value={ownerId ?? ''}
                    onChange={(e) => onSceneChange?.({ownerId: e.target.value || undefined})}
                >
                    <option value=''>{formatMessage(messages.noOwner)}</option>
                    {ownerId && !members.some((m) => m.id === ownerId) && <option value={ownerId}>{ownerName ?? ownerId}</option>}
                    {members.map((m) => (
                        <option
                            key={m.id}
                            value={m.id}
                        >
                            {m.username}
                        </option>
                    ))}
                </select>
            </label>
            <label className='CanvasBoard__propsLabel'>
                <input
                    type='checkbox'
                    checked={done}
                    onChange={(e) => onSceneChange?.({done: e.target.checked})}
                />
                <span className='CanvasBoard__propsCheck'>{formatMessage(messages.done)}</span>
            </label>
        </div>
    );
}

function Section({label, children}: {label: MessageDescriptor; children: React.ReactNode}) {
    const {formatMessage} = useIntl();
    return (
        <div
            className='CanvasBoard__propsSection'
            role='radiogroup'
            aria-label={formatMessage(label)}
        >
            <div
                className='CanvasBoard__propsLabel'
                aria-hidden={true}
            >
                {formatMessage(label)}
            </div>
            <div className='CanvasBoard__propsRow'>{children}</div>
        </div>
    );
}

type ChoicesProps<V> = {label: MessageDescriptor; options: Array<Option<V>>; current?: V; onPick: (v: V) => void};

// current is absent when the selected elements disagree, so no option is pressed.
function Choices<V extends string | number>({label, options, current, onPick}: ChoicesProps<V>) {
    const {formatMessage} = useIntl();
    return (
        <Section label={label}>
            {options.map((o) => (
                <button
                    key={o.value}
                    type='button'
                    className='CanvasBoard__propsButton'
                    aria-pressed={current === o.value}
                    onMouseDown={keepFocus}
                    onClick={() => onPick(o.value)}
                >
                    {formatMessage(o.label)}
                </button>
            ))}
        </Section>
    );
}

function Colors({label, colors, current, onPick, onPickLive, onCommit}: {label: MessageDescriptor; colors: string[]; current?: string; onPick: (c: string) => void; onPickLive: (c: string) => void; onCommit?: () => void}) {
    const {formatMessage} = useIntl();
    return (
        <Section label={label}>
            {colors.map((c) => (
                <button
                    key={c}
                    type='button'
                    className={`CanvasBoard__swatch${c === 'transparent' ? ' CanvasBoard__swatch--none' : ''}`}
                    style={{background: c}}
                    aria-label={c === 'transparent' ? formatMessage(messages.transparent) : c}
                    aria-pressed={current === c}
                    onMouseDown={keepFocus}
                    onClick={() => onPick(c)}
                />
            ))}
            <input
                type='color'
                className='CanvasBoard__colorInput'
                aria-label={formatMessage(messages.customColor)}
                value={current && current !== 'transparent' ? current : '#ffffff'}
                onChange={(e) => onPickLive(e.target.value)}
                onBlur={onCommit}
            />
        </Section>
    );
}

function Buttons({label, options, onPick}: {label: MessageDescriptor; options: Array<Option<PanelAction>>; onPick: (a: PanelAction) => void}) {
    const {formatMessage} = useIntl();
    return (
        <Section label={label}>
            {options.map((o) => (
                <button
                    key={o.value}
                    type='button'
                    className='CanvasBoard__propsButton'
                    onMouseDown={keepFocus}
                    onClick={() => onPick(o.value)}
                >
                    {formatMessage(o.label)}
                </button>
            ))}
        </Section>
    );
}

// Keys typed in the panel must not reach the board's shortcuts.
const stopKeys = (e: React.KeyboardEvent) => e.stopPropagation();

export default function CanvasProperties({types, values, onChange, onCommit, onAction, selectionCount, readOnly, info, scene, onSceneChange}: Props) {
    const {formatMessage} = useIntl();

    // A section shows only if every type in play supports it.
    const has = (...supported: ElementType[]) => types.every((t) => supported.includes(t));
    const choices = <V extends string | number>(key: keyof ElementStyle, label: MessageDescriptor, options: Array<Option<V>>) => (
        <Choices
            label={label}
            options={options}
            current={values[key] as V | undefined}
            onPick={(v) => onChange({[key]: v})}
        />
    );

    const summary = (
        <>
            {info && <Info info={info}/>}
            {scene && (
                <SceneFields
                    scene={scene}
                    readOnly={readOnly}
                    onSceneChange={onSceneChange}
                />
            )}
        </>
    );
    const onlyScenes = types.every((t) => t === 'scene');
    const onlyImages = types.every((t) => t === 'image');

    if (readOnly) {
        return (
            <div
                className='CanvasBoard__props'
                role='region'
                aria-label={formatMessage(messages.panel)}
            >
                {summary}
            </div>
        );
    }

    return (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only stops key events from reaching the board
        <div
            className='CanvasBoard__props'
            role='region'
            aria-label={formatMessage(messages.panel)}
            onKeyDown={stopKeys}
        >
            {summary}
            {!onlyImages && !scene?.ownerId && ( // an owned card is framed in its owner's colour
                <Colors
                    label={onlyScenes ? messages.frame : messages.stroke}
                    colors={STROKE_COLORS}
                    current={values.stroke}
                    onPick={(stroke) => onChange({stroke})}
                    onPickLive={(stroke) => onChange({stroke}, true)}
                    onCommit={onCommit}
                />
            )}
            {has(...SHAPES, 'frame') && (
                <Colors
                    label={messages.background}
                    colors={FILL_COLORS}
                    current={values.fill}
                    onPick={(fill) => onChange({fill})}
                    onPickLive={(fill) => onChange({fill}, true)}
                    onCommit={onCommit}
                />
            )}
            {has(...SHAPES) && choices('fillStyle', messages.fillStyle, FILL_STYLES)}
            {has('pen', ...SHAPES, ...LINES) && choices('strokeWidth', messages.strokeWidth, WIDTHS)}
            {has(...SHAPES, ...LINES) && choices('strokeStyle', messages.strokeStyle, STROKE_STYLES)}
            {has(...SHAPES, ...LINES) && choices('roughness', messages.sloppiness, ROUGHNESS)}
            {has('rect') && choices('roundness', messages.edges, EDGES)}
            {has(...LINES) && choices('startArrow', messages.startArrow, HEADS)}
            {has(...LINES) && choices('endArrow', messages.endArrow, HEADS)}
            {has('text') && choices('fontSize', messages.fontSize, FONT_SIZES)}
            {has('text') && choices('fontFamily', messages.fontFamily, FONTS)}
            {has('text') && choices('textAlign', messages.textAlign, TEXT_ALIGNS)}
            {!onlyScenes && (
                <div className='CanvasBoard__propsSection'>
                    <label className='CanvasBoard__propsLabel'>
                        {formatMessage(messages.opacity)}
                        <input
                            type='range'
                            className='CanvasBoard__opacity'
                            min={0}
                            max={100}
                            step={1}
                            value={values.opacity ?? 100}
                            onChange={(e) => onChange({opacity: Number(e.target.value)}, true)}
                            onPointerUp={onCommit}
                            onKeyUp={onCommit}
                            onBlur={onCommit}
                        />
                    </label>
                </div>
            )}
            {selectionCount > 0 && (
                <Buttons
                    label={messages.layers}
                    options={LAYERS}
                    onPick={onAction}
                />
            )}
            {selectionCount >= 2 && (
                <Buttons
                    label={messages.align}
                    options={ALIGNS}
                    onPick={onAction}
                />
            )}
            {selectionCount > 0 && (
                <Buttons
                    label={messages.actions}
                    options={ACTIONS}
                    onPick={onAction}
                />
            )}
        </div>
    );
}
