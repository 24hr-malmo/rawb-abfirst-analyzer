const vcHelper = require('./helpers/vc-helper');
const ProxyHelper = require('./helpers/proxy-helper');
let AB_TESTS_HOST;
let API_TOKEN;
let PROXY_HELPER;

/**
 * Takes data from Visual Composer and search through each module for A/B Test data and extract that data if found.
 *
 * @param {obj} data
 * @returns {obj} Object with this shape: {
 *     'someAbTestUuid': {'testUuid': 'someAbTestUuid', 'variantName': 'A' },
 *     'someOtherAbTestUuid': {'testUuid': 'someOtherAbTestUuid', 'variantName': 'B'}
 * }
 */
function getAbTestDataFromVcModules(data) {
    const modules = vcHelper.findVcItems(data['vc_content'], 'vc_row', 'button');

    let abTests = {};
    if (modules) {
        modules.forEach((module) => {
            if (module.attributes.ab_first && module.attributes.ab_first.use_ab_testing) {
                const abTestUuid = module.attributes.ab_first.ab_test_uuid;
                if (!abTests[abTestUuid]) {
                    abTests[abTestUuid] = [];
                }
                abTests[abTestUuid].push({
                    testUuid: abTestUuid,
                    variantName: module.attributes.ab_first.ab_test_variant_name,
                });
            }
        });
    }
    return abTests;
}


/**
 * Fetch all ab tests that has the visited page as a target
 *
 * @param {object} data - needs the page id as key 'id'
 * @param {} securityHeaders
 * @param {string} cookieHash - If user has visited the page before he has a cookie with which we can identify his assignments
 * @returns {object} Object with three properties: {testsWithPageAsGoal: [], testsWithPageAsGoalAssignments: [], cookieHash: ''}
 */
function getAbTestsWithPageAsGoal(data, securityHeaders, cookieHash) {
    const getTestsWithPageAsGoalUrl = `${AB_TESTS_HOST}/api/assignments/goal-page/${data.id}/${cookieHash}`;
    return PROXY_HELPER.get(getTestsWithPageAsGoalUrl, securityHeaders);
}


/**
 * Takes A/B Test data extracted from modules and get assignments etc for the specific user for those tests
 *
 * @param {obj} abTestDataFromModules - Extracted from modules. {'someUuid': {testUuid: 'someUuid', variantName: 'A'}, 'someOtherUuid': {testUuid: 'someOtherUuid', variantName: 'Original'} }
 * @param {object} data - needs the page id as a key 'id'
 * @param {} securityHeaders
 * @param {string} cookieHash - If user has visited the page before and already gotten an assignment, that is being saved in a cookie. This is the hash for that cookie.
 * @param {object} query - parsed query
 * @param {string} queryString - raw query
 * @returns {obj} assignments: Already existing assignments for the given cookie, or newly created assignments. abTestsWithPageAsGoal: Obj - The A/B tests that has the visited page as a goal/target for the test.
 */
async function createAssignments(abTestDataFromModules, data, securityHeaders, cookieHash, query, queryString) {
    // Special case if its a preview request
    if (query.abTestPreview) {
        const url = `${AB_TESTS_HOST}/api/assignments?${queryString}`;
        const assignments = await PROXY_HELPER.post(url, {}, securityHeaders);
        return {
            assignments,
            testsWithPageAsGoal: {},
        };
    }

    // If not preview
    const body = {
        cookieHash,
        abTests: abTestDataFromModules,
    };

    const url = `${AB_TESTS_HOST}/api/assignments`;
    const assignmentsPromise = PROXY_HELPER.post(url, body, securityHeaders);

    const abTestsWithPageAsGoalPromise = getAbTestsWithPageAsGoal(data, securityHeaders, cookieHash);
    const [ assignments, testsWithPageAsGoalData ] = await Promise.all([assignmentsPromise, abTestsWithPageAsGoalPromise]);
    const { testsWithPageAsGoal, testsWithPageAsGoalAssignments } = testsWithPageAsGoalData.data;

    // Add the assignments from goalPage, otherwise if user ends up at a target page we wont know if user is part of the test that target page belongs to or not
    assignments.data.testAssignments.concat(testsWithPageAsGoalAssignments);

    return {
        assignments,
        testsWithPageAsGoal,
    };
}


/**
 * Add custom stuff to the data that is to be returned to frontend-server, and maybe then analyzed there and removed before being sent to client.
 *
 * @param {obj} data
 * @param {array} assignments
 * @param {} abTestsWithPageAsGoal
 * @param {} cookie - Cookie from browser
 * @param {any} origin - The origin from where the data was being added, i.e where this module was being used. Could be 'resource-aggregator'
 * @param {} cookieHash - hash from ab service, to be set as a cookie
 * @returns {obj} the modified data
 */
function decorateData(data, assignments, abTestsWithPageAsGoal, cookie, origin, cookieHash) {
    data.decorated = data.decorated || {};
    data.decorated.abTests = data.decorated.abTests || {};

    // Set a cookie if user didnt already have one, and we got a hash from ab service
    if (!cookie && cookieHash) {
        data.decorated.abTests.cookieHash = {
            value: cookieHash,
            origin: origin
        };
    }

    if (abTestsWithPageAsGoal && abTestsWithPageAsGoal.length > 0) {
        data.decorated.abTests.testsWithPageAsGoal = abTestsWithPageAsGoal;
    }

    // Store all user assignments
    if (assignments) {
        assignments.forEach(assignment => {
            data.decorated = data.decorated || {};
            data.decorated.abTests = data.decorated.abTests || {};
            data.decorated.abTests.userAssignments = data.decorated.abTests.userAssignments || [];
            data.decorated.abTests.userAssignments.push({
                abTestUuid: assignment.testUuid,
                abTestName: assignment.testName,
                variant: assignment.variant,
                participant: assignment.participant,
            });
        });
    }

    return data;
}

/**
 * takes data from Visual Composer and remove all the rows/variants that has A/B Tests attached to it except for the one that has been assigned to the user.
 *
 * @param {obj} data
 * @param {obj} assignments - all the user assignments for the A/B Tests that are on the page user is visiting
 * @returns {obj} filtered data
 */
function filterNonAssignedVariants(data, assignments) {

    data['vc_content'] = data['vc_content'].filter((module) => {
        if (module.name === 'vc_row') {
            const atts = module.attributes;
            if (atts.ab_first && atts.ab_first.use_ab_testing && assignments.data.testAssignments) {
                const assignment = assignments.data.testAssignments.find(assignment => assignment.testUuid === atts.ab_first.ab_test_uuid);


                if (assignment && assignment.variant === atts.ab_first.ab_test_variant_name) {
                    return true;
                }

                if (!assignment && atts.ab_first.ab_test_variant_name === 'original') {
                    // If no assignment were found for this Ab Test.
                    // This could happen if the test isnt "live" yet. In those cases, we only show original
                    return true;
                }

                return false;
            }
            return true;
        }
        return true;
    });

    return data;
}

module.exports = function(settings) {
    constructor(settings);
    return {
        getAbTestDataFromVcModules,
        createAssignments,
        decorateData,
        filterNonAssignedVariants,
        getAbTestsWithPageAsGoal,
    };
};

function constructor(settings = {}) {
    if (!settings.abTestsHost) {
        throw new Error('abTestHost is missing in settings');
    }
    if (!settings.apiToken) {
        throw new Error('apiToken is missing in settings');
    }
    AB_TESTS_HOST = settings.abTestsHost;
    API_TOKEN = settings.apiToken;
    PROXY_HELPER = ProxyHelper.init(API_TOKEN);
}
