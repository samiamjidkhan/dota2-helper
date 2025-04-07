// Frontend logic will go here 

const heroForm = document.getElementById('heroForm');
const outputDiv = document.getElementById('output');
const errorMessageP = document.getElementById('error-message');
const heroDatalist = document.getElementById('heroList');
const loadingSpinner = document.getElementById('loadingSpinner');
const clearFormBtn = document.getElementById('clearFormBtn');
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
let heroIconMap = {}; // Store hero name -> icon URL

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
        heroIconMap = {};

        // Populate datalist and the Set of valid names
        heroesData.forEach(hero => {
            const option = document.createElement('option');
            option.value = hero.localized_name;
            // Add hero icon URL as a data attribute for potential future use
            option.dataset.icon = hero.icon; 
            heroDatalist.appendChild(option);
            validHeroNames.add(hero.localized_name); // Add to Set for validation
            heroIconMap[hero.localized_name] = hero.icon; // Store for display
        });

        console.log('Hero datalist and icon map populated.');
        submitButton.disabled = false; // Enable submit button once heroes are loaded

    } catch (error) {
        console.error('Error fetching or populating heroes:', error);
        errorMessageP.textContent = 'Failed to load hero list. Please refresh. Submit disabled.';
        submitButton.disabled = true; // Keep submit disabled if load fails
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
document.addEventListener('DOMContentLoaded', populateHeroData);

// Real-time validation hints on input blur (losing focus)
heroInputs.forEach(input => {
    input.addEventListener('blur', () => {
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

// Simple Markdown to Structured HTML Converter
// Handles specific headers from the refined prompt
function formatStructuredOutput(text) {
    let html = '';
    const lines = text.split('\n');
    let currentList = null; // To track if we are inside a list

    lines.forEach(line => {
        line = line.trim();
        // First, handle **bold** and *italic*
        line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // Bold
        line = line.replace(/\*([^\*]+?)\*/g, '<em>$1</em>');   // Italic (using single asterisks)
        // Note: Could also add support for _italic_ if needed: line = line.replace(/_([^_]+?)_/g, '<em>$1</em>');

        if (line.startsWith('### ')) {
            // Close previous list if open
            if (currentList) {
                html += `</ul>\n`;
                currentList = null;
            }
            html += `<h3>${line.substring(4).trim()}</h3>\n`;
        } else if (line.startsWith('* ') || line.startsWith('- ')) {
            // Start list if not already started
            if (!currentList) {
                html += `<ul>\n`;
                currentList = 'ul';
            }
             // IMPORTANT: Text inside list items was already processed for bold/italic above
            html += `<li>${line.substring(2).trim()}</li>\n`; 
        } else if (line === '' || line === '---') {
             // Close previous list on empty line or separator
             if (currentList) {
                html += `</ul>\n`;
                currentList = null;
             }
             if(line === '---') html += '<hr>\n'; else html += '<br>\n'; // Treat empty line as <br>
        } else if (line) { // Non-empty, non-header, non-list line
             // Close previous list if open
            if (currentList) {
                html += `</ul>\n`;
                currentList = null;
            }
            // IMPORTANT: Text inside paragraph was already processed for bold/italic above
            html += `<p>${line}</p>\n`; 
        }
    });

    // Close any list left open at the end
    if (currentList) {
        html += `</ul>\n`;
    }

    // Basic cleanup
    html = html.replace(/(\n){2,}/g, '\n'); 
    html = html.replace(/(<br>\s*){2,}/g, '<br>'); 
    html = html.replace(/<p><\/p>/g, ''); 

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

    const selectedHeroes = {
        yourHero: document.getElementById('yourHero').value,
        allies: [
            document.getElementById('ally1').value,
            document.getElementById('ally2').value,
            document.getElementById('ally3').value,
            document.getElementById('ally4').value,
        ],
        opponents: [
            document.getElementById('opponent1').value,
            document.getElementById('opponent2').value,
            document.getElementById('opponent3').value,
            document.getElementById('opponent4').value,
            document.getElementById('opponent5').value,
        ]
    };

    try {
        console.log('Sending API request with heroes:', selectedHeroes);
        const response = await fetch('/api/get-tips', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(selectedHeroes),
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