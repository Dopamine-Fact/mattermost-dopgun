// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import {LockOutlineIcon} from '@mattermost/compass-icons/components';
import type {PersonalNote} from '@mattermost/types/personal_notes';

type Props = {
    notes: PersonalNote[];
    currentUserId: string;
    ownerName: (userId: string) => string;
    onOpen: (note: PersonalNote) => void;
    onToggleDone: (note: PersonalNote) => void;
};

const UndatedList = ({notes, currentUserId, ownerName, onOpen, onToggleDone}: Props) => {
    const {formatMessage} = useIntl();

    return (
        <section className='PersonalNotes__undated'>
            <h3>
                <FormattedMessage
                    id='personal_notes.undated'
                    defaultMessage='Undated'
                />
            </h3>
            {notes.length === 0 ? (
                <p className='PersonalNotes__empty'>
                    <FormattedMessage
                        id='personal_notes.undated.empty'
                        defaultMessage='Notes without a date show up here.'
                    />
                </p>
            ) : (
                <ul>
                    {notes.map((note) => {
                        const own = note.user_id === currentUserId;
                        return (
                            <li
                                key={note.id}
                                className={classNames('PersonalNotes__undatedItem', {done: Boolean(note.done_at)})}
                            >
                                <input
                                    type='checkbox'
                                    checked={Boolean(note.done_at)}
                                    disabled={!own}
                                    aria-label={formatMessage({id: 'personal_notes.markDone', defaultMessage: 'Mark {title} done'}, {title: note.title})}
                                    onChange={() => onToggleDone(note)}
                                />
                                <button
                                    type='button'
                                    className='PersonalNotes__undatedTitle'
                                    onClick={() => onOpen(note)}
                                >
                                    {note.title}
                                </button>
                                {note.visibility === 'private' && <LockOutlineIcon size={14}/>}
                                {!own && <span className='PersonalNotes__owner'>{ownerName(note.user_id)}</span>}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
};

export default UndatedList;
