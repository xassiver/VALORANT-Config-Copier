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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function printHeader() {
    console.clear();
    console.log(`
    +-----------------------------------------------------------+
    |                                                           |
    |               VALORANT CONFIG COPIER PLUS                 |
    |                   ADVANCED COPIER SYSTEM                  |
    |                                                           |
    +-----------------------------------------------------------+
    `.cyan.bold);
}

const CATEGORIES = {
    crosshair: {
        name: 'Crosshair Settings',
        file: 'Windows/RiotUserSettings.ini',
        isIniSection: false,
        keywords: ['Crosshair']
    },
    video: {
        name: 'Video and Graphic Settings',
        file: 'WindowsClient/GameUserSettings.ini',
        isIniSection: true,
        sections: ['[/Script/ShooterGame.ShooterGameUserSettings]', '[ScalabilityGroups]']
    },
    audio: {
        name: 'Audio Settings',
        file: 'Windows/RiotUserSettings.ini',
        isIniSection: false,
        keywords: ['Volume', 'Voice', 'Mic']
    },
    gameplay: {
        name: 'Other Gameplay Settings (Mouse, Minimap etc.)',
        file: 'Windows/RiotUserSettings.ini',
        isIniSection: false,
        keywords: ['Mouse', 'Minimap', 'Gameplay', 'ColorBlind']
    }
};

async function main() {
    await printHeader();

    const profiles = await getValorantProfiles(VALORANT_CONFIG_PATH);
    if (!profiles || profiles.length < 2) {
        console.log('\n[!] Error: Could not find at least two Valorant profiles.'.red);
        return;
    }

    const enhancedProfiles = await enhanceProfilesWithPlayerNames(profiles);
    const { sourceProfile, destProfile } = await promptUserForProfiles(enhancedProfiles);

    if (!sourceProfile || !destProfile) {
        console.log('\n[!] Operation cancelled.'.yellow);
        return;
    }

    const sourceName = enhancedProfiles.find(p => p.value === sourceProfile).name;
    const destName = enhancedProfiles.find(p => p.value === destProfile).name;

    const { selectedCategories } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'selectedCategories',
            message: 'Select setting groups to copy (Use Space to select, Enter to confirm):',
            choices: [
                { name: 'Crosshair', value: 'crosshair' },
                { name: 'Video / Graphics', value: 'video' },
                { name: 'Audio Settings', value: 'audio' },
                { name: 'Gameplay (Mouse, Minimap etc.)', value: 'gameplay' }
            ],
            validate: (answer) => answer.length < 1 ? 'You must select at least one option.' : true
        }
    ]);

    console.log(`\n[*] Analyzing settings...`.blue);
    await sleep(500);

    const updates = {};
    const sourceBase = path.join(VALORANT_CONFIG_PATH, sourceProfile);
    const destBase = path.join(VALORANT_CONFIG_PATH, destProfile);

    for (const catKey of selectedCategories) {
        const cat = CATEGORIES[catKey];
        const sPath = path.join(sourceBase, cat.file);

        try {
            const content = await fs.readFile(sPath, 'utf8');
            updates[catKey] = {
                file: cat.file,
                data: []
            };

            if (cat.isIniSection) {
                for (const section of cat.sections) {
                    const data = getSection(content, section);
                    if (data) updates[catKey].data.push({ type: 'section', key: section, value: data });
                }
            } else {
                const lines = content.split(/\r?\n/);
                for (const line of lines) {
                    if (cat.keywords.some(kw => line.includes(kw))) {
                        updates[catKey].data.push({ type: 'line', value: line });
                    }
                }
            }
        } catch (e) {
            console.log(`\n[!] Warning: Could not read ${cat.file}, skipping this category.`.yellow);
        }
    }

    // Preview
    console.log(`\n+--- SETTINGS TO BE COPIED ---`.yellow);
    for (const catKey in updates) {
        console.log(`| > ${CATEGORIES[catKey].name.bold}`);
        const totalItems = updates[catKey].data.length;
        const previewItems = updates[catKey].data.slice(0, 5);

        previewItems.forEach(item => {
            const val = item.type === 'section' ? item.key : item.value;
            console.log(`|   - ${val.trim().gray}`);
        });
        if (totalItems > 5) console.log(`|   - (...and ${totalItems - 5} more settings)`.gray);
    }
    console.log(`+-----------------------------+`.yellow);

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: `Selected settings will be transferred to ${destName.yellow}. Do you confirm?`,
            default: false
        }
    ]);

    if (!confirm) {
        console.log('\n[!] Operation cancelled.'.yellow);
        return;
    }

    console.log(`\n[*] Transferring settings...`.blue);

    const filesToUpdate = [...new Set(Object.values(updates).map(u => u.file))];

    for (const fileRel of filesToUpdate) {
        const dPath = path.join(destBase, fileRel);
        try {
            let dContent = await fs.readFile(dPath, 'utf8');

            for (const catKey in updates) {
                if (updates[catKey].file === fileRel) {
                    for (const item of updates[catKey].data) {
                        if (item.type === 'section') {
                            dContent = replaceOrAddSection(dContent, item.key, item.value);
                        } else {
                            const lineKey = item.value.split('=')[0];
                            const lines = dContent.split(/\r?\n/);
                            let found = false;
                            for (let i = 0; i < lines.length; i++) {
                                if (lines[i].startsWith(lineKey + '=')) {
                                    lines[i] = item.value;
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) lines.push(item.value);
                            dContent = lines.join('\n');
                        }
                    }
                }
            }
            await fs.writeFile(dPath, dContent, 'utf8');
        } catch (e) {
            console.log(`[!] Error: Problem writing to ${fileRel}: ${e.message}`.red);
        }
    }

    console.log(`\n[+] SUCCESS: Settings transferred successfully.`.green.bold);
}

function getSection(content, sectionName) {
    const lines = content.split(/\r?\n/);
    let inSection = false;
    let sectionLines = [];

    for (let line of lines) {
        if (line.trim() === sectionName) {
            inSection = true;
            sectionLines.push(line);
            continue;
        }
        if (inSection) {
            if (line.trim().startsWith('[') && line.trim().endsWith(']')) break;
            sectionLines.push(line);
        }
    }
    return inSection ? sectionLines.join('\n').trim() : null;
}

function replaceOrAddSection(content, sectionName, newData) {
    const lines = content.split(/\r?\n/);
    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === sectionName) {
            startIndex = i;
            for (let j = i + 1; j < lines.length; j++) {
                if (lines[j].trim().startsWith('[') && lines[j].trim().endsWith(']')) {
                    endIndex = j;
                    break;
                }
            }
            if (endIndex === -1) endIndex = lines.length;
            break;
        }
    }

    if (startIndex !== -1) {
        lines.splice(startIndex, endIndex - startIndex, newData);
    } else {
        lines.push('\n' + newData);
    }
    return lines.join('\n');
}

async function getValorantProfiles(configPath) {
    try {
        const allEntries = await fs.readdir(configPath, { withFileTypes: true });
        return allEntries
            .filter((entry) => entry.isDirectory() && USER_ID_REGEX.test(entry.name))
            .map((entry) => entry.name);
    } catch (error) {
        return null;
    }
}

async function enhanceProfilesWithPlayerNames(profiles) {
    let apiKey = process.env.HENRIK_API_KEY;
    if (!apiKey) return profiles.map(p => ({ name: p, value: p }));

    console.log('[*] Fetching player info...'.blue);
    const promises = profiles.map(async (profileId) => {
        const playerName = await getPlayerName(profileId, apiKey);
        return {
            name: playerName ? `${playerName.green}` : `(Unknown: ${profileId.slice(0, 8)})`.red,
            value: profileId,
        };
    });

    return Promise.all(promises);
}

async function getPlayerName(puuidWithRegion, apiKey) {
    try {
        const parts = puuidWithRegion.split('-');
        const region = parts[parts.length - 1];
        const puuid = puuidWithRegion.substring(0, puuidWithRegion.lastIndexOf(`-${region}`));
        const url = `https://api.henrikdev.xyz/valorant/v1/by-puuid/account/${puuid}`;
        const response = await axios.get(url, { headers: { 'Authorization': apiKey } });
        const data = response.data.data;
        return data ? `${data.name}#${data.tag}` : null;
    } catch {
        return null;
    }
}

async function promptUserForProfiles(choices) {
    const { sourceValue } = await inquirer.prompt([
        {
            type: 'list',
            name: 'sourceValue',
            message: 'SOURCE Account (copy settings FROM):',
            choices: choices,
        },
    ]);

    const otherChoices = choices.filter((p) => p.value !== sourceValue);
    if (otherChoices.length === 0) return {};

    const { destValue } = await inquirer.prompt([
        {
            type: 'list',
            name: 'destValue',
            message: 'DESTINATION Account (copy settings TO):',
            choices: otherChoices,
        },
    ]);

    return { sourceProfile: sourceValue, destProfile: destValue };
}

main();
