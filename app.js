// Modified by XASAC
require('dotenv').config();
require('colors');

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const axios = require('axios');
const inquirer = require('inquirer');

const USER_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-.+$/;
const VALORANT_CONFIG_PATH = path.join(os.homedir(), 'AppData', 'Local', 'VALORANT', 'Saved', 'Config');

async function main() {
    console.log('--- VALORANT Config Copier ---'.cyan.bold);

    const profiles = await getValorantProfiles(VALORANT_CONFIG_PATH);
    if (!profiles || profiles.length < 2) {
        console.log('Error: Could not find at least two Valorant user profiles in:'.red, VALORANT_CONFIG_PATH.yellow);
        console.log('Please ensure Valorant is installed and you have logged into more than one account.'.red);
        return;
    }

    const enhancedProfiles = await enhanceProfilesWithPlayerNames(profiles);
    const { sourceProfile, destProfile } = await promptUserForProfiles(enhancedProfiles);

    if (!sourceProfile || !destProfile) {
        console.log('Operation cancelled.'.yellow);
        return;
    }

    const sourceName = enhancedProfiles.find(p => p.value === sourceProfile).name;
    const destName = enhancedProfiles.find(p => p.value === destProfile).name;

    const { confirmation } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirmation',
            message: `Are you sure you want to ${'OVERWRITE'.red.bold} the settings in ${destName.yellow} with the settings from ${sourceName.yellow}? This action cannot be undone.`,
            default: false,
        },
    ]);

    if (!confirmation) {
        console.log('Operation cancelled.'.yellow);
        return;
    }

    try {
        const sourcePath = path.join(VALORANT_CONFIG_PATH, sourceProfile);
        const destPath = path.join(VALORANT_CONFIG_PATH, destProfile);

        console.log(`\nCopying settings from ${sourceName} to ${destName}...`.blue);

        await fs.rm(destPath, { recursive: true, force: true });
        await fs.mkdir(destPath, { recursive: true });
        await fs.cp(sourcePath, destPath, { recursive: true });

        console.log('\n✅ Success! Configs copied successfully.'.green.bold);
    } catch (error) {
        console.error('\n❌ An error occurred during the copy process:'.red);
        console.error(error);
    }
}

async function getValorantProfiles(configPath) {
    try {
        const allEntries = await fs.readdir(configPath, { withFileTypes: true });
        return allEntries
            .filter((entry) => entry.isDirectory() && USER_ID_REGEX.test(entry.name))
            .map((entry) => entry.name);
    } catch (error) {
        console.error(`Error accessing Valorant config directory: ${configPath}`.red);
        console.error('Please make sure Valorant is installed and the path is correct.'.red);
        return null;
    }
}

async function enhanceProfilesWithPlayerNames(profiles) {
    let apiKey = process.env.HENRIK_API_KEY;

    if (apiKey) {
        console.log('HenrikDev API key found in your .env file.'.blue);
    } else {
        console.log('No HenrikDev API key found in .env file.'.yellow);
        const { promptedKey } = await inquirer.prompt([{
            type: 'password',
            name: 'promptedKey',
            mask: '*',
            message: 'Please enter your HenrikDev API key:',
        }]);
        apiKey = promptedKey;
    }

    if (!apiKey) {
        console.log('No API key provided. Using profile IDs instead.'.yellow);
        return profiles.map(p => ({ name: p, value: p }));
    }

    console.log('Fetching player names using HenrikDev API...'.blue);
    const promises = profiles.map(async (profileId) => {
        const playerName = await getPlayerName(profileId, apiKey);
        return {
            name: playerName ? `${playerName.green.bold}` : `(Could not fetch name for ${profileId})`.red,
            value: profileId,
        };
    });

    return Promise.all(promises);
}

/**
 * Fetches player name using HenrikDev API
 * @param {string} puuidWithRegion e.g., 'xxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-eu'
 * @param {string} apiKey Your HenrikDev API key
 * @returns {Promise<string|null>} Player name (Name#Tag) or null if fetching failed
 */
async function getPlayerName(puuidWithRegion, apiKey) {
    try {
        const parts = puuidWithRegion.split('-');
        const puuid = puuidWithRegion.substring(0, puuidWithRegion.lastIndexOf(`-${parts[parts.length - 1]}`));

        const url = `https://api.henrikdev.xyz/valorant/v1/by-puuid/account/${puuid}`;

        const response = await axios.get(url, {
            headers: { 'Authorization': apiKey },
        });

        const accountData = response.data.data;
        if (accountData && accountData.name && accountData.tag) {
            return `${accountData.name}#${accountData.tag}`;
        } else {
            return null;
        }
    } catch (error) {
        if (error.response) {
            if (error.response.status === 401 || error.response.status === 403) {
                console.error(`  - Error: ${'Invalid or unauthorized HenrikDev API Key'.yellow}`);
            } else {
                console.error(`  - Error fetching name for PUUID ending in ...${puuidWithRegion.slice(-10)}: API returned status ${error.response.status}`.yellow);
            }
        } else {
            console.error(`  - Network or other error fetching name for PUUID ending in ...${puuidWithRegion.slice(-10)}`.yellow);
        }
        return null;
    }
}


async function promptUserForProfiles(choices) {
    const validChoices = choices.filter(c => !c.name.includes('Could not fetch'));

    if (validChoices.length < 2) {
        console.log("\nCould not fetch enough player names to perform a copy. Please check your API key.".red.bold);
        return {};
    }

    const { sourceValue } = await inquirer.prompt([
        {
            type: 'list',
            name: 'sourceValue',
            message: 'Select the SOURCE profile (copy settings FROM):',
            choices: validChoices,
        },
    ]);

    const otherChoices = validChoices.filter((p) => p.value !== sourceValue);
    if (otherChoices.length === 0) {
        console.log('Only one profile available, cannot copy.'.yellow);
        return {};
    }

    const { destValue } = await inquirer.prompt([
        {
            type: 'list',
            name: 'destValue',
            message: 'Select the DESTINATION profile (copy settings TO):',
            choices: otherChoices,
        },
    ]);

    return { sourceProfile: sourceValue, destProfile: destValue };
}

main();