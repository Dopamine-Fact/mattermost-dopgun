// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {useEffect, useRef, useState} from 'react';
import {FormattedMessage} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';

import {Radio} from '@mattermost/compass-ui/components/radio';
import type {PreferencesType} from '@mattermost/types/preferences';

import {savePreferences} from 'mattermost-redux/actions/preferences';
import {Preferences} from 'mattermost-redux/constants';
import {shouldShowDmPanel} from 'mattermost-redux/selectors/entities/preferences';
import {getCurrentUserId} from 'mattermost-redux/selectors/entities/users';

import SettingItemMax from 'components/setting_item_max';
import SettingItemMin from 'components/setting_item_min';
import type SettingItemMinComponent from 'components/setting_item_min';

import type {GlobalState} from 'types/store';

type Props = {
    active: boolean;
    areAllSectionsInactive: boolean;
    updateSection: (section: string) => void;
    adminMode?: boolean;
    userId: string;
    userPreferences?: PreferencesType;
};

const SECTION = 'showDmPanel';

/** Settings > Sidebar choice between the right-hand DM panel and the classic sidebar DM category. */
export default function ShowDmPanel(props: Props) {
    const dispatch = useDispatch();
    const userPreferences = props.adminMode ? props.userPreferences : undefined;
    const userId = useSelector((state: GlobalState) => (props.adminMode ? props.userId : getCurrentUserId(state)));
    const showDmPanel = useSelector((state: GlobalState) => shouldShowDmPanel(state, userPreferences));
    const [checked, setChecked] = useState(showDmPanel);
    const [saving, setSaving] = useState(false);
    const minRef = useRef<SettingItemMinComponent>(null);
    const wasActive = useRef(props.active);

    useEffect(() => {
        if (props.active && !wasActive.current) {
            setChecked(showDmPanel);
        }
        if (!props.active && wasActive.current && props.areAllSectionsInactive) {
            minRef.current?.focus();
        }
        wasActive.current = props.active;
    }, [props.active, props.areAllSectionsInactive, showDmPanel]);

    const title = (
        <FormattedMessage
            id='user.settings.sidebar.showDmPanelTitle'
            defaultMessage='Show direct messages in a right panel'
        />
    );
    const on = (
        <FormattedMessage
            id='user.settings.sidebar.on'
            defaultMessage='On'
        />
    );
    const off = (
        <FormattedMessage
            id='user.settings.sidebar.off'
            defaultMessage='Off'
        />
    );

    if (!props.active) {
        return (
            <SettingItemMin
                title={title}
                describe={showDmPanel ? on : off}
                section={SECTION}
                updateSection={props.updateSection}
                ref={minRef}
            />
        );
    }

    const submit = async () => {
        setSaving(true);
        await dispatch(savePreferences(userId, [{
            user_id: userId,
            category: Preferences.CATEGORY_SIDEBAR_SETTINGS,
            name: Preferences.SHOW_DM_PANEL,
            value: String(checked),
        }]));
        setSaving(false);
        props.updateSection('');
    };

    return (
        <SettingItemMax
            title={title}
            inputs={
                <fieldset>
                    <legend className='form-legend hidden-label'>{title}</legend>
                    <div className='settings-radio-group'>
                        <Radio
                            data-testid='showDmPanelOn'
                            name={SECTION}
                            checked={checked}
                            onChange={() => setChecked(true)}
                        >
                            {on}
                        </Radio>
                        <Radio
                            data-testid='showDmPanelOff'
                            name={SECTION}
                            checked={!checked}
                            onChange={() => setChecked(false)}
                        >
                            {off}
                        </Radio>
                    </div>
                    <div className='mt-5'>
                        <FormattedMessage
                            id='user.settings.sidebar.showDmPanelDesc'
                            defaultMessage='When enabled, direct messages are listed in a collapsible panel on the right instead of the sidebar.'
                        />
                    </div>
                </fieldset>
            }
            submit={submit}
            saving={saving}
            updateSection={props.updateSection}
        />
    );
}
