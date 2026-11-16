// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

const pad = (n: number) => String(n).padStart(2, '0');

// Due dates are stored as local midnight in ms; 0 means no due date.
export function toDateInput(ms: number): string {
    if (!ms) {
        return '';
    }
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromDateInput(value: string): number {
    if (!value) {
        return 0;
    }
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
}

export function isOverdue(dueAt: number, now = new Date()): boolean {
    return dueAt > 0 && dueAt < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}
