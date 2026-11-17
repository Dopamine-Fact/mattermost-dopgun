// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';

import {GenericModal} from '@mattermost/components';
import type {UserProfile} from '@mattermost/types/users';

import {Client4} from 'mattermost-redux/client';
import {getTeammateNameDisplaySetting} from 'mattermost-redux/selectors/entities/preferences';
import {displayUsername} from 'mattermost-redux/utils/user_utils';

type Props = {
    teamId: string;
    members: UserProfile[];
    selected: string[];
    onExited: () => void;
    onSaved: (userIds: string[]) => void;
};

// AssigneesModal picks who must send daily reports; nobody checked means every member.
const AssigneesModal = ({teamId, members, selected, onExited, onSaved}: Props) => {
    const {formatMessage} = useIntl();
    const nameDisplay = useSelector(getTeammateNameDisplaySetting);
    const [show, setShow] = useState(true);
    const [checked, setChecked] = useState(() => new Set(selected));
    const [filter, setFilter] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const people = useMemo(() => members.
        filter((u) => !u.is_bot && !u.delete_at).
        map((u) => ({id: u.id, name: displayUsername(u, nameDisplay), username: u.username})).
        sort((a, b) => a.name.localeCompare(b.name)), [members, nameDisplay]);
    const query = filter.trim().toLowerCase();
    const shown = query ? people.filter((p) => p.name.toLowerCase().includes(query) || p.username.toLowerCase().includes(query)) : people;

    const toggle = (id: string) => setChecked((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) {
            next.add(id);
        }
        return next;
    });

    const save = async () => {
        setBusy(true);
        setError('');
        try {
            onSaved(await Client4.setDailyReportAssignees(teamId, Array.from(checked)));
            setShow(false);
        } catch (e) {
            setError((e as Error).message);
        }
        setBusy(false);
    };

    return (
        <GenericModal
            id='dailyReportAssigneesModal'
            className='DailyReportAssigneesModal'
            modalHeaderText={formatMessage({id: 'daily_reports.reportersModal.title', defaultMessage: 'Who sends daily reports'})}
            show={show}
            onExited={onExited}
            onHide={() => setShow(false)}
            handleCancel={() => setShow(false)}
            handleConfirm={save}
            confirmButtonText={formatMessage({id: 'daily_reports.save', defaultMessage: 'Save'})}
            isConfirmDisabled={busy}
            isConfirmLoading={busy}
            autoCloseOnConfirmButton={false}
            compassDesign={true}
            errorText={error || undefined}
        >
            <div className='DailyReportsModal__body'>
                <p className='DailyReportsModal__hint'>
                    <FormattedMessage
                        id='daily_reports.reportersModal.hint'
                        defaultMessage='Only checked members are asked for a report and reminded. Leave everyone unchecked to ask every member.'
                    />
                </p>
                <input
                    className='form-control'
                    type='search'
                    aria-label={formatMessage({id: 'daily_reports.reportersModal.search', defaultMessage: 'Search members'})}
                    placeholder={formatMessage({id: 'daily_reports.reportersModal.search', defaultMessage: 'Search members'})}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                />
                <ul className='DailyReportsModal__list'>
                    {shown.map((p) => (
                        <li key={p.id}>
                            <label>
                                <input
                                    type='checkbox'
                                    checked={checked.has(p.id)}
                                    onChange={() => toggle(p.id)}
                                />
                                {p.name}
                            </label>
                        </li>
                    ))}
                </ul>
            </div>
        </GenericModal>
    );
};

export default AssigneesModal;
