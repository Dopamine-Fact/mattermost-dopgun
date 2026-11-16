// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import React from 'react';

import FeatureDiscovery from 'components/admin_console/feature_discovery/feature_discovery';

import {
    renderWithContext,
    screen,
    waitFor,
} from 'tests/react_testing_utils';
import {LicenseSkus} from 'utils/constants';

import GroupsSVG from './features/images/groups_svg';

describe('components/feature_discovery', () => {
    describe('FeatureDiscovery', () => {
        test('should match the default state of the component when is not cloud environment', () => {
            const getCloudSubscription = jest.fn();
            const openModal = jest.fn();

            renderWithContext(
                <FeatureDiscovery
                    featureName='test'
                    minimumSKURequiredForFeature={LicenseSkus.Professional}
                    title={{
                        id: 'translation.test.title',
                        defaultMessage: 'Foo',
                    }}
                    copy={{
                        id: 'translation.test.copy',
                        defaultMessage: 'Bar',
                    }}
                    learnMoreURL='https://test.mattermost.com/secondary/'
                    featureDiscoveryImage={<GroupsSVG/>}
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    stats={{TOTAL_USERS: 20}}
                    isCloud={false}
                    isCloudTrial={false}
                    hadPrevCloudTrial={false}
                    isSubscriptionLoaded={true}
                    isPaidSubscription={false}
                    actions={{
                        getCloudSubscription,
                        openModal,
                    }}
                />,
            );

            expect(screen.queryByText('Bar')).toBeInTheDocument();
            expect(screen.queryByText('Foo')).toBeInTheDocument();
            expect(screen.getByTestId('featureDiscovery_title').tagName).toBe('SPAN');

            expect(screen.queryByRole('button', {name: 'Start trial'})).not.toBeInTheDocument();
            expect(screen.getByRole('button', {name: 'Contact sales'})).toBeInTheDocument();

            //cloud option
            expect(screen.queryByRole('button', {name: 'Try free for 30 days'})).not.toBeInTheDocument();

            const featureLink = screen.getByTestId('featureDiscovery_secondaryCallToAction');

            expect(featureLink).toBeInTheDocument();
            expect(featureLink).toHaveAttribute('href', 'https://test.mattermost.com/secondary/?utm_source=mattermost&utm_medium=in-product&utm_content=feature_discovery&uid=&sid=&edition=team&server_version=');
            expect(featureLink).toHaveTextContent('Learn more');

            expect(getCloudSubscription).not.toHaveBeenCalled();
            expect(openModal).not.toHaveBeenCalled();
        });

        test('should match component state when is cloud environment', async () => {
            const getCloudSubscription = jest.fn();
            const openModal = jest.fn();

            await waitFor(() => {
                renderWithContext(
                    <FeatureDiscovery
                        featureName='test'
                        minimumSKURequiredForFeature={LicenseSkus.Professional}
                        title={{
                            id: 'translation.test.title',
                            defaultMessage: 'Foo',
                        }}
                        copy={{
                            id: 'translation.test.copy',
                            defaultMessage: 'Bar',
                        }}
                        learnMoreURL='https://test.mattermost.com/secondary/'
                        featureDiscoveryImage={<GroupsSVG/>}
                        // eslint-disable-next-line @typescript-eslint/naming-convention
                        stats={{TOTAL_USERS: 20}}
                        isCloud={true}
                        isCloudTrial={false}
                        hadPrevCloudTrial={false}
                        isPaidSubscription={false}
                        isSubscriptionLoaded={true}
                        actions={{
                            getCloudSubscription,
                            openModal,
                        }}
                    />,
                );
            });

            // subscription is loaded, so loadingSpinner should not be visible
            expect(screen.queryByTestId('loadingSpinner')).not.toBeInTheDocument();

            expect(screen.queryByText('Bar')).toBeInTheDocument();
            expect(screen.queryByText('Foo')).toBeInTheDocument();
            expect(screen.getByTestId('featureDiscovery_title').tagName).toBe('SPAN');

            //this option is visible only when it is cloud environment
            expect(screen.getByRole('button', {name: 'Contact sales'})).toBeInTheDocument();

            expect(screen.getByTestId('featureDiscovery_secondaryCallToAction')).toHaveAttribute('href', 'https://test.mattermost.com/secondary/?utm_source=mattermost&utm_medium=in-product&utm_content=feature_discovery&uid=&sid=&edition=team&server_version=');

            const featureLink = screen.getByTestId('featureDiscovery_secondaryCallToAction');

            expect(featureLink).toBeInTheDocument();
            expect(featureLink).toHaveAttribute('href', 'https://test.mattermost.com/secondary/?utm_source=mattermost&utm_medium=in-product&utm_content=feature_discovery&uid=&sid=&edition=team&server_version=');
            expect(featureLink).toHaveTextContent('Learn more');

            expect(getCloudSubscription).not.toHaveBeenCalled();
            expect(openModal).not.toHaveBeenCalled();

            expect(screen.queryByRole('button', {name: 'Start trial'})).not.toBeInTheDocument();
        });

        test('should match component state when is cloud environment and subscription is not loaded yet in redux store', () => {
            const getCloudSubscription = jest.fn();
            const openModal = jest.fn();

            renderWithContext(
                <FeatureDiscovery
                    featureName='test'
                    minimumSKURequiredForFeature={LicenseSkus.Professional}
                    title={{
                        id: 'translation.test.title',
                        defaultMessage: 'Foo',
                    }}
                    copy={{
                        id: 'translation.test.copy',
                        defaultMessage: 'Bar',
                    }}
                    learnMoreURL='https://test.mattermost.com/secondary/'
                    featureDiscoveryImage={<GroupsSVG/>}
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    stats={{TOTAL_USERS: 20}}
                    isCloud={true}
                    isCloudTrial={false}
                    hadPrevCloudTrial={false}
                    isSubscriptionLoaded={false}
                    isPaidSubscription={false}
                    actions={{
                        getCloudSubscription,
                        openModal,
                    }}
                />,
            );

            // when is cloud and subscription is not loaded yet, then only loading spinner is visible
            expect(screen.getByTestId('loadingSpinner')).toBeInTheDocument();

            expect(screen.queryByText('Bar')).not.toBeInTheDocument();
            expect(screen.queryByText('Foo')).not.toBeInTheDocument();

            //this option is visible only when subscription is loaded and is cloud environment
            expect(screen.queryByRole('button', {name: 'Try free for 30 days'})).not.toBeInTheDocument();

            expect(screen.queryByTestId('featureDiscovery_secondaryCallToAction')).not.toBeInTheDocument();

            expect(getCloudSubscription).not.toHaveBeenCalled();
            expect(openModal).not.toHaveBeenCalled();

            expect(screen.queryByRole('button', {name: 'Start trial'})).not.toBeInTheDocument();
        });

        test('should show Contact Sales when isEnterpriseReady is false (Team Edition)', () => {
            const getCloudSubscription = jest.fn();
            const openModal = jest.fn();

            renderWithContext(
                <FeatureDiscovery
                    featureName='test'
                    minimumSKURequiredForFeature={LicenseSkus.Professional}
                    title={{
                        id: 'translation.test.title',
                        defaultMessage: 'Foo',
                    }}
                    copy={{
                        id: 'translation.test.copy',
                        defaultMessage: 'Bar',
                    }}
                    learnMoreURL='https://test.mattermost.com/secondary/'
                    featureDiscoveryImage={<GroupsSVG/>}
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    stats={{TOTAL_USERS: 20}}
                    isCloud={false}
                    isCloudTrial={false}
                    hadPrevCloudTrial={false}
                    isSubscriptionLoaded={true}
                    isPaidSubscription={false}
                    actions={{
                        getCloudSubscription,
                        openModal,
                    }}
                />,
            );

            expect(screen.queryByText('Bar')).toBeInTheDocument();
            expect(screen.queryByText('Foo')).toBeInTheDocument();
            expect(screen.getByTestId('featureDiscovery_title').tagName).toBe('SPAN');

            // Should show Contact Sales button instead of Start Trial when Team Edition
            const contactSalesButton = screen.getByRole('button', {name: 'Contact sales'});
            expect(contactSalesButton).toBeInTheDocument();
            expect(contactSalesButton.className).toMatch(/size-medium/);
            expect(contactSalesButton.className).not.toMatch(/size-large/);
            expect(screen.queryByRole('button', {name: 'Start trial'})).not.toBeInTheDocument();

            const featureLink = screen.getByTestId('featureDiscovery_secondaryCallToAction');
            expect(featureLink).toBeInTheDocument();
            expect(featureLink).toHaveAttribute('href', 'https://test.mattermost.com/secondary/?utm_source=mattermost&utm_medium=in-product&utm_content=feature_discovery&uid=&sid=&edition=team&server_version=');
            expect(featureLink).toHaveTextContent('Learn more');
            expect(featureLink.tagName).toBe('A');
            expect(featureLink.className).toMatch(/size-medium/);
            expect(featureLink.className).not.toMatch(/size-large/);
            expect(featureLink.closest('button')).toBeNull();

            expect(getCloudSubscription).not.toHaveBeenCalled();
            expect(openModal).not.toHaveBeenCalled();
        });

        test('should show Contact Sales when previous trial license exists', () => {
            const getCloudSubscription = jest.fn();
            const openModal = jest.fn();

            renderWithContext(
                <FeatureDiscovery
                    featureName='test'
                    minimumSKURequiredForFeature={LicenseSkus.Professional}
                    title={{
                        id: 'translation.test.title',
                        defaultMessage: 'Foo',
                    }}
                    copy={{
                        id: 'translation.test.copy',
                        defaultMessage: 'Bar',
                    }}
                    learnMoreURL='https://test.mattermost.com/secondary/'
                    featureDiscoveryImage={<GroupsSVG/>}
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    stats={{TOTAL_USERS: 20}}
                    isCloud={false}
                    isCloudTrial={false}
                    hadPrevCloudTrial={false}
                    isSubscriptionLoaded={true}
                    isPaidSubscription={false}
                    actions={{
                        getCloudSubscription,
                        openModal,
                    }}
                />,
            );

            expect(screen.queryByText('Bar')).toBeInTheDocument();
            expect(screen.queryByText('Foo')).toBeInTheDocument();
            expect(screen.getByTestId('featureDiscovery_title').tagName).toBe('SPAN');

            // Should show Contact Sales button when previous trial license exists
            const contactSalesButton = screen.getByRole('button', {name: 'Contact sales'});
            expect(contactSalesButton).toBeInTheDocument();
            expect(contactSalesButton.className).toMatch(/size-medium/);
            expect(contactSalesButton.className).not.toMatch(/size-large/);
            expect(screen.queryByRole('button', {name: 'Start trial'})).not.toBeInTheDocument();

            const featureLink = screen.getByTestId('featureDiscovery_secondaryCallToAction');
            expect(featureLink).toBeInTheDocument();
            expect(featureLink).toHaveAttribute('href', 'https://test.mattermost.com/secondary/?utm_source=mattermost&utm_medium=in-product&utm_content=feature_discovery&uid=&sid=&edition=team&server_version=');
            expect(featureLink).toHaveTextContent('Learn more');
            expect(featureLink.tagName).toBe('A');
            expect(featureLink.className).toMatch(/size-medium/);
            expect(featureLink.className).not.toMatch(/size-large/);
            expect(featureLink.closest('button')).toBeNull();

            expect(getCloudSubscription).not.toHaveBeenCalled();
            expect(openModal).not.toHaveBeenCalled();
        });

        test('should not render SKU label when showSkuTag is omitted', () => {
            renderWithContext(
                <FeatureDiscovery
                    featureName='test'
                    minimumSKURequiredForFeature={LicenseSkus.Professional}
                    title={{
                        id: 'translation.test.title',
                        defaultMessage: 'Foo',
                    }}
                    copy={{
                        id: 'translation.test.copy',
                        defaultMessage: 'Bar',
                    }}
                    learnMoreURL='https://test.mattermost.com/secondary/'
                    featureDiscoveryImage={<GroupsSVG/>}
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    stats={{TOTAL_USERS: 20}}
                    isCloud={false}
                    isCloudTrial={false}
                    hadPrevCloudTrial={false}
                    isSubscriptionLoaded={true}
                    isPaidSubscription={false}
                    actions={{
                        getCloudSubscription: jest.fn(),
                        openModal: jest.fn(),
                    }}
                />,
            );

            expect(screen.queryByText('PROFESSIONAL')).not.toBeInTheDocument();
        });

        test('should render SKU label when showSkuTag is true', () => {
            renderWithContext(
                <FeatureDiscovery
                    featureName='test'
                    minimumSKURequiredForFeature={LicenseSkus.Professional}
                    showSkuTag={true}
                    title={{
                        id: 'translation.test.title',
                        defaultMessage: 'Foo',
                    }}
                    copy={{
                        id: 'translation.test.copy',
                        defaultMessage: 'Bar',
                    }}
                    learnMoreURL='https://test.mattermost.com/secondary/'
                    featureDiscoveryImage={<GroupsSVG/>}
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    stats={{TOTAL_USERS: 20}}
                    isCloud={false}
                    isCloudTrial={false}
                    hadPrevCloudTrial={false}
                    isSubscriptionLoaded={true}
                    isPaidSubscription={false}
                    actions={{
                        getCloudSubscription: jest.fn(),
                        openModal: jest.fn(),
                    }}
                />,
            );

            expect(screen.getByText('PROFESSIONAL')).toBeInTheDocument();
        });
    });
});
