// Frontend logic will go here 

const heroForm = document.getElementById('heroForm');
const outputDiv = document.getElementById('output');
const errorMessageP = document.getElementById('error-message');
const heroDatalist = document.getElementById('heroList');
const loadingSpinner = document.getElementById('loadingSpinner');
const clearFormBtn = document.getElementById('clearFormBtn');
const yourHeroRoleSelect = document.getElementById('yourHeroRole');
const allyLabels = [
    document.getElementById('ally1-label'),
    document.getElementById('ally2-label'),
    document.getElementById('ally3-label'),
    document.getElementById('ally4-label')
];
const submitButton = heroForm.querySelector('button[type="submit"]');

// Get all hero input elements
const heroInputs = [
    document.getElementById('yourHero'),
    document.getElementById('ally1'),
    document.getElementById('ally2'),
    document.getElementById('ally3'),
    document.getElementById('ally4'),
    document.getElementById('opponent1'),
    document.getElementById('opponent2'),
    document.getElementById('opponent3'),
    document.getElementById('opponent4'),
    document.getElementById('opponent5')
];

let validHeroNames = new Set(); // To store valid hero names for validation
const ROLES = ['Safe Lane', 'Midlane', 'Offlane', 'Support', 'Hard Support'];

// let heroIconMap = {}; // Removed: No longer fetching icons

const HERO_ABBREVIATIONS = {
    'Ancient Apparition': genAbbreviations('aa'),
    'Anti-Mage': genAbbreviations('am'),
    'Bounty Hunter': genAbbreviations('bh'),
    'Chaos Knight': genAbbreviations('ck'),
    'Crystal Maiden': genAbbreviations('cm'),
    'Dark Seer': genAbbreviations('ds'),
    'Death Prophet': genAbbreviations('dp'),
    'Dragon Knight': genAbbreviations('dk'),
    'Elder Titan': genAbbreviations('et'),
    'Faceless Void': genAbbreviations('fv'),
    'Keeper of the Light': genAbbreviations('kotl'),
    'Legion Commander': genAbbreviations('lc'),
    'Lone Druid': genAbbreviations('ld'),
    'Monkey King': genAbbreviations('mk'),
    'Nature\'s Prophet': genAbbreviations('np'),
    'Night Stalker': genAbbreviations('ns'),
    'Outworld Destroyer': genAbbreviations('od'),
    'Phantom Assassin': genAbbreviations('pa'),
    'Phantom Lancer': genAbbreviations('pl'),
    'Queen of Pain': genAbbreviations('qop'),
    'Sand King': genAbbreviations('sk'),
    'Shadow Demon': genAbbreviations('sd'),
    'Shadow Fiend': genAbbreviations('sf'),
    'Skywrath Mage': genAbbreviations('sm'),
    'Spirit Breaker': genAbbreviations('sb'),
    'Templar Assassin': genAbbreviations('ta'),
    'Windranger': genAbbreviations('wr'),
    'Winter Wyvern': genAbbreviations('ww'),
    'Witch Doctor': genAbbreviations('wd'),
    'Wraith King': genAbbreviations('wk')
};

function genAbbreviations(baseAbbr) {
    return [
        baseAbbr.toUpperCase(),
        baseAbbr.charAt(0).toUpperCase() + baseAbbr.slice(1).toLowerCase(),
        baseAbbr
    ];
}

// Populates the role dropdown for the user's hero
function populateRoleDropdown() {
    ROLES.forEach(role => {
        const option = document.createElement('option');
        option.value = role;
        option.textContent = role;
        yourHeroRoleSelect.appendChild(option);
    });
}

// Updates the labels for the ally heroes based on the user's selected role
function updateAllyRoles() {
    const selectedRole = yourHeroRoleSelect.value;
    const remainingRoles = ROLES.filter(r => r !== selectedRole);
    allyLabels.forEach((label, index) => {
        if (label) {
            // e.g., "Offlane"
            label.textContent = remainingRoles[index];
        }
    });
}

// Function to fetch heroes and populate the datalist + icon map
async function populateHeroData() {
    try {
        const response = await fetch('/api/heroes');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const heroesData = await response.json(); // Expecting { localized_name, icon }

        // Clear existing datalist options
        heroDatalist.innerHTML = ''; 
        validHeroNames.clear();
        // heroIconMap = {}; // Removed

        // Populate datalist and the Set of valid names
        heroesData.forEach(hero => {
            const option = document.createElement('option');
            option.value = hero.localized_name;
            // Add hero icon URL as a data attribute for potential future use
            // option.dataset.icon = hero.icon; // Removed: No icon data
            heroDatalist.appendChild(option);
            validHeroNames.add(hero.localized_name); // Add to Set for validation
            // heroIconMap[hero.localized_name] = hero.icon; // Removed
        });

        console.log('Hero datalist populated.');
        submitButton.disabled = false; // Enable submit button once heroes are loaded

    } catch (error) {
        console.error('Error fetching or populating heroes:', error);
        errorMessageP.textContent = 'Failed to load hero list. Please refresh. Submit disabled.';
        submitButton.disabled = true; // Keep submit disabled if load fails
    }
}

function autoCorrectInputs(input) {
    for (const [heroName, abbrSet] of Object.entries(HERO_ABBREVIATIONS)) {
        if (abbrSet.includes(input.value.trim())) {
            input.value = heroName;
            break;
        }
    }
    const separator = input.value.includes('-') ? '-' : ' ' // Anti-Mage

    let heroName = input.value
        .trim()
        .replace(/\s+/g, ' ') // handle multiple spaces between words; e.g. 'Phantom  Lancer'

    if (heroName.toLowerCase() === 'keeper of the light') {
        input.value = 'Keeper of the Light'
    } else {
        const splitLength = heroName.split(separator).length;
        if (splitLength <= 2) {
            heroName = heroName
                .split(separator)
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(separator);
        }

        // Auto correct hero name if possible
        if (validHeroNames.has(heroName)) {
            input.value = heroName;
        }
    }
}

// Function to validate hero inputs (with real-time feedback hints)
function validateHeroInputs(isFinalCheck = false) {
    let isValid = true;
    let currentSelections = {};
    let firstErrorMessage = '';

    // Clear previous invalid styles first
    heroInputs.forEach(input => input.classList.remove('invalid'));
    if (isFinalCheck) errorMessageP.textContent = ''; // Clear main error only on submit check

    for (const input of heroInputs) {
        const heroName = input.value.trim();
        let fieldError = null;

        if (heroName === '') {
            if (isFinalCheck) fieldError = 'All hero fields must be filled.'; // Only show required error on final submit
            input.classList.add('invalid');
            isValid = false;
        } else if (!validHeroNames.has(heroName)) {
            fieldError = `"${heroName}" is not a valid hero.`;
            input.classList.add('invalid');
            isValid = false;
        } else if (currentSelections[heroName]) {
            fieldError = `"${heroName}" selected multiple times.`;
            input.classList.add('invalid');
            // Also mark the previously selected input as invalid
            currentSelections[heroName].inputElement.classList.add('invalid');
            isValid = false;
        } else {
            currentSelections[heroName] = { inputElement: input }; // Record valid selection
            input.classList.remove('invalid'); // Explicitly remove invalid if previously marked
        }

        // Store the *first* error message encountered for display
        if (fieldError && !firstErrorMessage) {
            firstErrorMessage = fieldError;
        }
    }

    // Display the first error message if performing the final check before submit
    if (isFinalCheck) {
        errorMessageP.textContent = firstErrorMessage;
    }

    return isValid;
}

// Call the function to populate datalist when the page loads
document.addEventListener('DOMContentLoaded', () => {
    populateHeroData();
    populateRoleDropdown();
    updateAllyRoles(); // Set initial ally roles
});

// Add event listener for when the user changes their role selection
yourHeroRoleSelect.addEventListener('change', updateAllyRoles);

// Real-time validation hints on input blur (losing focus)
heroInputs.forEach(input => {
    input.addEventListener('blur', () => {
        autoCorrectInputs(input);
        validateHeroInputs(false); // Run validation, but don't show main error message yet
    });
    // Clear specific input error on typing
    input.addEventListener('input', () => {
        input.classList.remove('invalid');
         // If user types, clear the main error message as well
        if (errorMessageP.textContent) {
             errorMessageP.textContent = '';
        }
    });
});

// Enhanced Markdown to Structured HTML Converter
// Handles headers, lists, tables, and inline formatting
function formatStructuredOutput(text) {
    let html = '';
    const lines = text.split('\n');
    let currentList = null;
    let currentListType = null;
    let inTable = false;
    let tableRows = [];

    // Helper to process inline formatting
    function processInline(text) {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')  // Bold
            .replace(/\*([^\*]+?)\*/g, '<em>$1</em>')          // Italic
            .replace(/`([^`]+)`/g, '<code>$1</code>')          // Inline code
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>'); // Links
    }

    // Helper to close current list
    function closeList() {
        if (currentList) {
            html += currentListType === 'ol' ? '</ol>\n' : '</ul>\n';
            currentList = null;
            currentListType = null;
        }
    }

    // Helper to render table
    function renderTable() {
        if (tableRows.length === 0) return;

        html += '<div class="table-wrapper"><table>\n';
        tableRows.forEach((row, index) => {
            const cells = row.split('|').filter(cell => cell.trim() !== '');
            // Skip separator rows (|---|---|)
            if (cells.every(cell => /^[\s-:]+$/.test(cell))) {
                return;
            }
            const tag = index === 0 ? 'th' : 'td';
            const rowClass = index === 0 ? 'table-header' : (index % 2 === 0 ? 'table-row-even' : 'table-row-odd');
            html += `<tr class="${rowClass}">`;
            cells.forEach(cell => {
                html += `<${tag}>${processInline(cell.trim())}</${tag}>`;
            });
            html += '</tr>\n';
        });
        html += '</table></div>\n';
        tableRows = [];
        inTable = false;
    }

    lines.forEach((line, index) => {
        const trimmedLine = line.trim();

        // Check for table rows (lines starting with |)
        if (trimmedLine.startsWith('|') && trimmedLine.endsWith('|')) {
            closeList();
            inTable = true;
            tableRows.push(trimmedLine);
            return;
        } else if (inTable) {
            renderTable();
        }

        // Headers
        if (trimmedLine.startsWith('### ')) {
            closeList();
            html += `<h3>${processInline(trimmedLine.substring(4).trim())}</h3>\n`;
        } else if (trimmedLine.startsWith('## ')) {
            closeList();
            html += `<h4>${processInline(trimmedLine.substring(3).trim())}</h4>\n`;
        }
        // Numbered list (1. 2. 3. etc)
        else if (/^\d+\.\s/.test(trimmedLine)) {
            if (currentListType !== 'ol') {
                closeList();
                html += '<ol>\n';
                currentList = true;
                currentListType = 'ol';
            }
            const content = trimmedLine.replace(/^\d+\.\s/, '');
            html += `<li>${processInline(content)}</li>\n`;
        }
        // Unordered list
        else if (trimmedLine.startsWith('* ') || trimmedLine.startsWith('- ')) {
            if (currentListType !== 'ul') {
                closeList();
                html += '<ul>\n';
                currentList = true;
                currentListType = 'ul';
            }
            html += `<li>${processInline(trimmedLine.substring(2).trim())}</li>\n`;
        }
        // Horizontal rule
        else if (trimmedLine === '---' || trimmedLine === '***') {
            closeList();
            html += '<hr>\n';
        }
        // Empty line
        else if (trimmedLine === '') {
            closeList();
        }
        // Regular paragraph
        else if (trimmedLine) {
            closeList();
            html += `<p>${processInline(trimmedLine)}</p>\n`;
        }
    });

    // Close any remaining open elements
    closeList();
    if (inTable) renderTable();

    // Cleanup
    html = html.replace(/(<p><\/p>\s*)+/g, '');
    html = html.replace(/(<br>\s*){3,}/g, '<br><br>');

    return html;
}

// Handle form submission
heroForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!validateHeroInputs(true)) { // Perform final validation check
        outputDiv.innerHTML = ''; // Clear any previous results or errors
        loadingSpinner.style.display = 'none';
        return;
    }

    // Show loading spinner, hide output
    loadingSpinner.style.display = 'flex';
    outputDiv.style.display = 'none';
    outputDiv.innerHTML = ''; // Clear previous output
    errorMessageP.textContent = ''; // Clear validation errors
    submitButton.disabled = true; // Disable button during request
    clearFormBtn.disabled = true;

    // --- Construct the payload with hero and role information ---
    const yourRole = yourHeroRoleSelect.value;
    const yourHeroName = document.getElementById('yourHero').value;
    const remainingRoles = ROLES.filter(r => r !== yourRole);

    // My Team
    const myTeam = [{ role: yourRole, hero: yourHeroName }];
    const allyInputs = [
        document.getElementById('ally1'),
        document.getElementById('ally2'),
        document.getElementById('ally3'),
        document.getElementById('ally4')
    ];
    allyInputs.forEach((input, index) => {
        myTeam.push({ role: remainingRoles[index], hero: input.value });
    });

    // Opponent Team (roles are fixed from HTML labels)
    const opponentRoles = ['Safe Lane', 'Midlane', 'Offlane', 'Support', 'Hard Support'];
    const opponentInputs = [
        document.getElementById('opponent1'),
        document.getElementById('opponent2'),
        document.getElementById('opponent3'),
        document.getElementById('opponent4'),
        document.getElementById('opponent5')
    ];
    const opponentTeam = opponentInputs.map((input, index) => {
        return { role: opponentRoles[index], hero: input.value };
    });

    const selectedData = { myTeam, opponentTeam };

    try {
        console.log('Sending API request with heroes and roles:', selectedData);
        const response = await fetch('/api/get-tips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(selectedData),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `HTTP error ${response.status}`);
        }

        // Process and display structured results
        outputDiv.innerHTML = formatStructuredOutput(data.tips);

    } catch (error) {
        console.error('Error fetching tips:', error);
        // Display error in a more prominent way (e.g., within the output div for now)
        outputDiv.innerHTML = `<div class="error-box"><strong>Request Failed:</strong> ${error.message}</div>`;
    } finally {
        // Hide spinner, show output, re-enable buttons
        loadingSpinner.style.display = 'none';
        outputDiv.style.display = 'block';
        submitButton.disabled = false;
        clearFormBtn.disabled = false;
    }
});

// Clear form button
clearFormBtn.addEventListener('click', () => {
    heroForm.reset(); // Reset form fields
    heroInputs.forEach(input => input.classList.remove('invalid')); // Clear validation styles
    errorMessageP.textContent = ''; // Clear error message
    outputDiv.innerHTML = ''; // Clear results area
    outputDiv.style.display = 'block'; // Ensure output area is visible
    loadingSpinner.style.display = 'none'; // Ensure spinner is hidden
});
