// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';
import {useIntl} from 'react-intl';
import {useSelector, useDispatch} from 'react-redux';

import {GenericModal} from '@mattermost/components';

import {isCurrentUserSystemAdmin} from 'mattermost-redux/selectors/entities/users';

import {closeModal} from 'actions/views/modals';
import {isModalOpen} from 'selectors/views/modals';

import {NotifyStatus} from 'components/common/hooks/useGetNotifyAdmin';
import useOpenPricingModal from 'components/common/hooks/useOpenPricingModal';
import {useNotifyAdmin} from 'components/notify_admin_cta/notify_admin_cta';

import {ModalIdentifiers} from 'utils/constants';

import type {GlobalState} from 'types/store';

import './feature_restricted_modal.scss';

type FeatureRestrictedModalProps = {
    titleAdminPostTrial?: string;
    messageAdminPostTrial?: string;
    titleEndUser?: string;
    messageEndUser?: string;
    customSecondaryButton?: {msg: string; action: () => void};
    feature?: string;
    minimumPlanRequiredForFeature?: string;
};

const FeatureRestrictedModal = ({
    titleAdminPostTrial,
    messageAdminPostTrial,
    titleEndUser,
    messageEndUser,
    customSecondaryButton,
    feature,
    minimumPlanRequiredForFeature,
}: FeatureRestrictedModalProps) => {
    const {formatMessage} = useIntl();
    const dispatch = useDispatch();

    const isSystemAdmin = useSelector(isCurrentUserSystemAdmin);
    const show = useSelector((state: GlobalState) => isModalOpen(state, ModalIdentifiers.FEATURE_RESTRICTED_MODAL));
    const {openPricingModal, isAirGapped} = useOpenPricingModal();

    const [notifyAdminBtnText, notifyAdmin, notifyRequestStatus] = useNotifyAdmin({
        ctaText: formatMessage({
            id: 'feature_restricted_modal.button.notify',
            defaultMessage: 'Notify admin',
        }),
    }, {
        required_feature: feature || '',
        required_plan: minimumPlanRequiredForFeature || '',
        trial_notification: false,
    });

    if (!show) {
        return null;
    }

    const dismissAction = () => {
        dispatch(closeModal(ModalIdentifiers.FEATURE_RESTRICTED_MODAL));
    };

    const handleViewPlansClick = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
        if (isSystemAdmin && !isAirGapped) {
            openPricingModal();
            dismissAction();
        } else if (!isSystemAdmin) {
            notifyAdmin(e);
        }
    };

    const getTitle = () => {
        if (isSystemAdmin) {
            return titleAdminPostTrial;
        }

        return titleEndUser;
    };

    const getMessage = () => {
        if (isSystemAdmin) {
            return messageAdminPostTrial;
        }

        return messageEndUser;
    };

    // define what is the secondary button text and action, by default will be the View Plan button
    let secondaryBtnMsg = formatMessage({id: 'feature_restricted_modal.button.plans', defaultMessage: 'View plans'});
    if (!isSystemAdmin) {
        secondaryBtnMsg = notifyAdminBtnText as string;
    }
    let secondaryBtnAction = handleViewPlansClick;
    if (customSecondaryButton) {
        secondaryBtnMsg = customSecondaryButton.msg;
        secondaryBtnAction = customSecondaryButton.action;
    }

    // Hide view plans button for admins if air-gapped
    const showSecondaryButton = !isAirGapped || !isSystemAdmin || customSecondaryButton;

    return (
        <GenericModal
            id='FeatureRestrictedModal'
            className='FeatureRestrictedModal'
            compassDesign={true}
            modalHeaderText={getTitle()}
            onExited={dismissAction}
        >
            <div className='FeatureRestrictedModal__body'>
                <p className='FeatureRestrictedModal__description'>
                    {getMessage()}
                </p>
                <div className='FeatureRestrictedModal__buttons single'>
                    {showSecondaryButton && (
                        <button
                            id='button-plans'
                            className='button-plans'
                            onClick={secondaryBtnAction}
                            disabled={notifyRequestStatus === NotifyStatus.AlreadyComplete}
                        >
                            {secondaryBtnMsg}
                        </button>
                    )}
                </div>
            </div>
        </GenericModal>
    );
};

export default FeatureRestrictedModal;
