// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import * as TIMEOUTS from '../../fixtures/timeouts';

Cypress.Commands.add('uiResetPermissionsToDefault', () => {
    // # Navigate to system scheme page
    cy.visit('/admin_console/user_management/permissions/system_scheme');

    // # Click reset to defaults and confirm
    cy.findByTestId('resetPermissionsToDefault', {timeout: TIMEOUTS.HALF_MIN}).click();
    cy.get('#confirmModalButton').click();
    cy.uiSaveConfig();
});

Cypress.Commands.add('uiSaveConfig', ({confirm = true} = {}) => {
    // # Save settings
    cy.get('#saveSetting').should('be.enabled').click();
    cy.wait(TIMEOUTS.HALF_SEC);

    if (confirm) {
        // # Wait until the UI shows the saving is done and revert the text to "Save"
        cy.waitUntil(() => cy.get('#saveSetting').then((el) => {
            return el[0].innerText === 'Save';
        }));
    } else {
        cy.wait(TIMEOUTS.HALF_SEC);
    }
});
