// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useCallback, useEffect, useRef, useState} from 'react';

type Modifiers = {ctrl?: boolean; shift?: boolean};

/** Windows Explorer selection over an ordered list of item keys: click, Ctrl+click, Shift+click, rubber band. */
export function useExplorerSelection(keys: string[]) {
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [anchor, setAnchor] = useState<string>();

    useEffect(() => {
        const live = new Set(keys);
        setSelected((prev) => {
            const kept = [...prev].filter((k) => live.has(k));
            return kept.length === prev.size ? prev : new Set(kept);
        });
        setAnchor((a) => (a && live.has(a) ? a : undefined));
    }, [keys]);

    const click = useCallback((key: string, {ctrl, shift}: Modifiers = {}) => {
        const from = anchor === undefined ? -1 : keys.indexOf(anchor);
        const to = keys.indexOf(key);
        if (shift && from >= 0 && to >= 0) {
            const range = keys.slice(Math.min(from, to), Math.max(from, to) + 1);
            setSelected((prev) => new Set(ctrl ? [...prev, ...range] : range));
            return;
        }
        setAnchor(key);
        setSelected((prev) => {
            if (!ctrl) {
                return new Set([key]);
            }
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, [anchor, keys]);

    const selectAll = useCallback(() => setSelected(new Set(keys)), [keys]);
    const clear = useCallback(() => setSelected(new Set()), []);
    const setFromRect = useCallback((rectKeys: string[], additive: boolean) => {
        setSelected((prev) => new Set(additive ? [...prev, ...rectKeys] : rectKeys));
    }, []);

    return {selected, anchor, click, selectAll, clear, setFromRect};
}

type Box = {left: number; top: number; width: number; height: number};

/**
 * Rubber-band selection: dragging from empty space inside the container draws a box and reports the
 * keys of every [data-entry-key] element it touches. A click on empty space without dragging clears.
 */
export function useRubberBand(onRect: (keys: string[], additive: boolean) => void) {
    const [box, setBox] = useState<Box>();
    const onRectRef = useRef(onRect);
    onRectRef.current = onRect;

    const onMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('[data-entry-key], button, input, a')) {
            return;
        }
        const container = event.currentTarget;
        const additive = event.ctrlKey || event.metaKey;
        const startX = event.clientX;
        const startY = event.clientY;
        let dragged = false;

        const update = (e: MouseEvent) => {
            const rect = {left: Math.min(startX, e.clientX), top: Math.min(startY, e.clientY), width: Math.abs(e.clientX - startX), height: Math.abs(e.clientY - startY)};
            if (!dragged && rect.width < 4 && rect.height < 4) {
                return;
            }
            dragged = true;
            setBox(rect);
            const hit = [...container.querySelectorAll<HTMLElement>('[data-entry-key]')].filter((el) => {
                const r = el.getBoundingClientRect();
                return r.left < rect.left + rect.width && r.right > rect.left && r.top < rect.top + rect.height && r.bottom > rect.top;
            }).map((el) => el.dataset.entryKey!);
            onRectRef.current(hit, additive);
        };
        const end = () => {
            document.removeEventListener('mousemove', update);
            document.removeEventListener('mouseup', end);
            setBox(undefined);
            if (!dragged && !additive) {
                onRectRef.current([], false);
            }
        };
        event.preventDefault();
        document.addEventListener('mousemove', update);
        document.addEventListener('mouseup', end);
    }, []);

    return {box, onMouseDown};
}
