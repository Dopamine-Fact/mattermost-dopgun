// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {act, renderHook} from '@testing-library/react';

import {useExplorerSelection} from './use_explorer_selection';

const keys = ['a', 'b', 'c', 'd', 'e'];
const setup = () => renderHook(({k}) => useExplorerSelection(k), {initialProps: {k: keys}});
const sel = (r: ReturnType<typeof setup>) => [...r.result.current.selected].sort();

describe('useExplorerSelection', () => {
    test('plain click selects one item and sets the anchor', () => {
        const r = setup();
        act(() => r.result.current.click('b', {}));
        act(() => r.result.current.click('d', {}));
        expect(sel(r)).toEqual(['d']);
        expect(r.result.current.anchor).toBe('d');
    });

    test('Ctrl toggles items', () => {
        const r = setup();
        act(() => r.result.current.click('a', {}));
        act(() => r.result.current.click('c', {ctrl: true}));
        expect(sel(r)).toEqual(['a', 'c']);
        act(() => r.result.current.click('a', {ctrl: true}));
        expect(sel(r)).toEqual(['c']);
    });

    test('Shift selects the range from the anchor, in either direction', () => {
        const r = setup();
        act(() => r.result.current.click('d', {}));
        act(() => r.result.current.click('b', {shift: true}));
        expect(sel(r)).toEqual(['b', 'c', 'd']);
        act(() => r.result.current.click('e', {shift: true}));
        expect(sel(r)).toEqual(['d', 'e']);
        expect(r.result.current.anchor).toBe('d');
    });

    test('setFromRect replaces, or adds when additive', () => {
        const r = setup();
        act(() => r.result.current.click('a', {}));
        act(() => r.result.current.setFromRect(['c', 'd'], false));
        expect(sel(r)).toEqual(['c', 'd']);
        act(() => r.result.current.setFromRect(['a'], true));
        expect(sel(r)).toEqual(['a', 'c', 'd']);
    });

    test('selectAll and clear', () => {
        const r = setup();
        act(() => r.result.current.selectAll());
        expect(sel(r)).toEqual(keys);
        act(() => r.result.current.clear());
        expect(sel(r)).toEqual([]);
    });

    test('drops keys that disappear from the list', () => {
        const r = setup();
        act(() => r.result.current.selectAll());
        r.rerender({k: ['a', 'b']});
        expect(sel(r)).toEqual(['a', 'b']);
    });
});
