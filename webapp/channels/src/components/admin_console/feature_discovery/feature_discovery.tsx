// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React, {type JSX} from 'react';
import type {MessageDescriptor} from 'react-intl';
import {FormattedMessage} from 'react-intl';

import type {ButtonAsChildProps, ButtonProps} from '@mattermost/compass-ui/components/button';
import {FeatureDiscoveryPanel} from '@mattermost/compass-ui/components/feature-discovery-panel';
import type {AnalyticsState} from '@mattermost/types/admin';
import type {CloudCustomer} from '@mattermost/types/cloud';

import AlertBanner from 'components/alert_banner';
import ExternalLink from 'components/external_link';
import LoadingSpinner from 'components/widgets/loading/loading_spinner';
import {licenseSkuToLabel} from 'components/widgets/tag/sku_tag';

import type {LicenseSkus} from 'utils/constants';
import {goToMattermostContactSalesForm} from 'utils/contact_support_sales';

import type {ModalData} from 'types/actions';

// Compass ButtonProps omits data-* keys that Cypress selectors still rely on.
type PanelButtonProps = ButtonProps & {
    'data-testid'?: string;
};

type Props = {
    featureName: string;
    minimumSKURequiredForFeature: LicenseSkus;

    title: MessageDescriptor;
    copy: MessageDescriptor;

    learnMoreURL: string;

    featureDiscoveryImage: JSX.Element;

    stats?: AnalyticsState;
    actions: {
        getCloudSubscription: () => void;
        openModal: <P>(modalData: ModalData<P>) => void;
    };
    isCloud: boolean;
    isCloudTrial: boolean;
    hadPrevCloudTrial: boolean;
    isSubscriptionLoaded: boolean;
    isPaidSubscription: boolean;
    customer?: CloudCustomer;
    showSkuTag?: boolean;
};

export default class FeatureDiscovery extends React.PureComponent<Props> {
    contactSalesFunc = () => {
        const {customer, isCloud} = this.props;
        const customerEmail = customer?.email || '';
        const firstName = customer?.contact_first_name || '';
        const lastName = customer?.contact_last_name || '';
        const companyName = customer?.name || '';
        const utmMedium = isCloud ? 'in-product-cloud' : 'in-product';
        goToMattermostContactSalesForm(firstName, lastName, companyName, customerEmail, 'mattermost', utmMedium);
    };

    renderLearnMoreSecondaryAction = (
        emphasis: ButtonProps['emphasis'] = 'secondary',
        size: ButtonProps['size'] = 'medium',
    ): ButtonAsChildProps => ({
        asChild: true,
        emphasis,
        size,
        children: (
            <ExternalLink
                location='feature_discovery'
                href={this.props.learnMoreURL}
                data-testid='featureDiscovery_secondaryCallToAction'
            >
                <FormattedMessage
                    id='admin.ldap_feature_discovery.call_to_action.secondary'
                    defaultMessage='Learn more'
                />
            </ExternalLink>
        ),
    });

    renderContactSalesPrimaryAction = (size: ButtonProps['size'] = 'medium'): PanelButtonProps => ({
        emphasis: 'primary',
        size,
        'data-testid': 'featureDiscovery_primaryCallToAction',
        onClick: () => {
            this.contactSalesFunc();
        },
        children: (
            <FormattedMessage
                id='admin.ldap_feature_discovery_cloud.call_to_action.primary_sales'
                defaultMessage='Contact sales'
            />
        ),
    });

    renderPostTrialActions = () => {
        return {
            primaryAction: this.renderContactSalesPrimaryAction(),
            secondaryAction: this.renderLearnMoreSecondaryAction('tertiary'),
        };
    };

    render() {
        const {
            title,
            copy,
            featureDiscoveryImage,
            isCloud,
            isCloudTrial,
            isSubscriptionLoaded,
            showSkuTag,
            minimumSKURequiredForFeature,
        } = this.props;

        if (isCloud && !isSubscriptionLoaded) {
            return (<LoadingSpinner/>);
        }

        if (isCloud && isCloudTrial && isSubscriptionLoaded) {
            return (
                <div className='FeatureDiscovery'>
                    <AlertBanner
                        mode='info'
                        title={
                            <FormattedMessage
                                id='admin.featureDiscovery.WarningTitle'
                                defaultMessage='Your trial has started and updates are being made to your license.'
                            />
                        }
                        message={
                            <>
                                <FormattedMessage
                                    id='admin.featureDiscovery.WarningDescription'
                                    defaultMessage='Your License is being updated to give you full access to all the Enterprise Features. This page will automatically refresh once the license update is complete. Please wait '
                                />
                                <LoadingSpinner/>
                            </>
                        }
                    />
                </div>
            );
        }

        const panelActions: {
            primaryAction?: PanelButtonProps;
            secondaryAction?: ButtonAsChildProps;
        } = this.renderPostTrialActions();

        // Pass null when hidden so the panel does not fall back to its PROFESSIONAL default.
        const skuLabel = showSkuTag ? licenseSkuToLabel(minimumSKURequiredForFeature) : null;

        return (
            <div
                className='FeatureDiscovery'
                data-testid='featureDiscovery'
            >
                <FeatureDiscoveryPanel
                    className='FeatureDiscovery_panel'
                    skuLabel={skuLabel}
                    title={
                        <span data-testid='featureDiscovery_title'>
                            <FormattedMessage
                                {...title}
                            />
                        </span>
                    }
                    description={
                        <FormattedMessage
                            {...copy}
                        />
                    }
                    primaryAction={panelActions.primaryAction}

                    // FeatureDiscoveryPanel types secondaryAction as ButtonProps; asChild is supported at runtime in compass-ui ≥0.1.0-alpha.15
                    secondaryAction={panelActions.secondaryAction as ButtonProps | undefined}
                    illustration={{
                        'aria-label': '',
                        children: featureDiscoveryImage,
                    }}
                />
            </div>
        );
    }
}
