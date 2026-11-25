// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import type {TeamFilesFolder} from '@mattermost/types/drive';

import {Client4} from 'mattermost-redux/client';

import {DOPAMINE_FILES_TEMPLATE} from './dopamine_files_template';

type Props = {
    teamId: string;
};

// Strips the folder ids the server filled in, so the editor shows only what an admin writes; saving matches folders by name.
const withoutIds = (list: TeamFilesFolder[]): TeamFilesFolder[] => list.map(({id, children, ...rest}) => ({...rest, ...(children?.length ? {children: withoutIds(children)} : {})})); // eslint-disable-line @typescript-eslint/no-unused-vars

const toText = (list: TeamFilesFolder[]) => (list.length ? JSON.stringify(withoutIds(list), null, 2) : '');

// TeamFilesTemplate edits the team's Files page layout: a JSON folder list saved on its own, apart from the settings panel.
const TeamFilesTemplate = ({teamId}: Props) => {
    const {formatMessage} = useIntl();
    const [text, setText] = useState('');
    const [saved, setSaved] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{error: boolean; text: string}>();

    useEffect(() => {
        Client4.getTeamFilesTemplate(teamId).then((list) => {
            setText(toText(list));
            setSaved(toText(list));
        }, (err) => setMessage({error: true, text: err?.message || String(err)}));
    }, [teamId]);

    const save = async () => {
        let folders: TeamFilesFolder[];
        try {
            folders = text.trim() ? JSON.parse(text) : [];
        } catch (err) {
            setMessage({error: true, text: formatMessage({id: 'general_tab.filesTemplate.invalidJson', defaultMessage: 'The template is not valid JSON: {error}'}, {error: (err as Error).message})});
            return;
        }
        setBusy(true);
        setMessage(undefined);
        try {
            const result = await Client4.saveTeamFilesTemplate(teamId, folders);
            setText(toText(result));
            setSaved(toText(result));
            setMessage({error: false, text: formatMessage({id: 'general_tab.filesTemplate.saved', defaultMessage: 'Template saved; its folders are ready on the Files page.'})});
        } catch (err) {
            setMessage({error: true, text: (err as Error)?.message || String(err)});
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className='TeamFilesTemplate'>
            <label htmlFor='teamFilesTemplate'>
                <FormattedMessage
                    id='general_tab.filesTemplate.title'
                    defaultMessage='Files page template'
                />
            </label>
            <p className='TeamFilesTemplate__help'>
                <FormattedMessage
                    id='general_tab.filesTemplate.help'
                    defaultMessage='A JSON list of top folders: name, description, children, kind ("library", "projects", "production" for episode channels, "channels" for all channels) and access ("admin" hides the folder from everyone but admins, "read" lets only admins write). Leave it empty for no template.'
                />
            </p>
            <textarea
                id='teamFilesTemplate'
                className='form-control TeamFilesTemplate__text'
                rows={12}
                spellCheck={false}
                value={text}
                onChange={(e) => setText(e.target.value)}
            />
            <div className='TeamFilesTemplate__actions'>
                <button
                    type='button'
                    className='btn btn-tertiary btn-sm'
                    onClick={() => setText(toText(DOPAMINE_FILES_TEMPLATE))}
                >
                    <FormattedMessage
                        id='general_tab.filesTemplate.loadDopamine'
                        defaultMessage='Load the Dopamine template'
                    />
                </button>
                <button
                    type='button'
                    className='btn btn-primary btn-sm'
                    disabled={busy || text === saved}
                    onClick={save}
                >
                    <FormattedMessage
                        id='general_tab.filesTemplate.save'
                        defaultMessage='Save template'
                    />
                </button>
            </div>
            {message && <p className={message.error ? 'TeamFilesTemplate__error' : 'TeamFilesTemplate__saved'}>{message.text}</p>}
        </div>
    );
};

export default TeamFilesTemplate;
