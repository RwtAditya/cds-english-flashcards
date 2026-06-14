// State Variables
let dueCards = [];
let allCards = [];
let currentIndex = 0;
let isFlipped = false;

// Quiz State
let quizCards = [];
let quizIndex = 0;
let quizScore = 0;
let isQuizFlipped = false;

// File System Access State
let fileHandle = null;
let lastSavedJsonStr = ""; // Tracks last saved state for auto-save detection

// DOM Elements
const flashcard = document.getElementById('flashcard');
const reviewActions = document.getElementById('review-actions');
const reviseProgress = document.getElementById('revise-progress');
const revisionContent = document.getElementById('revision-content');
const reviseEmpty = document.getElementById('revise-empty');

// Text inputs on Flashcard
const cardFrontTag = document.getElementById('card-front-tag');
const cardFrontText = document.getElementById('card-front-text');
const cardBackTag = document.getElementById('card-back-tag');
const cardBackText = document.getElementById('card-back-text');
const cardBackExampleContainer = document.getElementById('card-back-example-container');
const cardBackExample = document.getElementById('card-back-example');

// Quiz Elements
const quizStartScreen = document.getElementById('quiz-start-screen');
const quizGameScreen = document.getElementById('quiz-game-screen');
const quizResultsScreen = document.getElementById('quiz-results-screen');
const quizFlashcard = document.getElementById('quiz-flashcard');
const quizFrontTag = document.getElementById('quiz-front-tag');
const quizFrontText = document.getElementById('quiz-front-text');
const quizBackTag = document.getElementById('quiz-back-tag');
const quizBackText = document.getElementById('quiz-back-text');
const quizBackExampleContainer = document.getElementById('quiz-back-example-container');
const quizBackExample = document.getElementById('quiz-back-example');
const quizProgress = document.getElementById('quiz-progress');
const quizScoreIndicator = document.getElementById('quiz-score-indicator');
const quizActions = document.getElementById('quiz-actions');

// Edit Modal Elements
const editModal = document.getElementById('edit-modal');
const editCardForm = document.getElementById('edit-card-form');
const editCardId = document.getElementById('edit-card-id');
const editCategory = document.getElementById('edit-category');
const editExample = document.getElementById('edit-example');

// Dynamic Form Containers
const addDynamicFieldsContainer = document.getElementById('add-dynamic-fields-container');
const editDynamicFieldsContainer = document.getElementById('edit-dynamic-fields-container');

// Cookie Helpers
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

function setCookie(name, value, days) {
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
    expires = `; expires=${date.toUTCString()}`;
  }
  document.cookie = `${name}=${value || ""}${expires}; path=/; SameSite=Lax`;
}

// Helper to get local date in YYYY-MM-DD
function getLocalDateString(offsetDays = 0) {
  const date = new Date();
  if (offsetDays !== 0) {
    date.setDate(date.getDate() + offsetDays);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Fisher-Yates Shuffle Algorithm
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  loadCardsFromStorage();
  initStreak();
  
  // Setup forms
  document.getElementById('add-card-form').addEventListener('submit', handleAddCard);
  document.getElementById('edit-card-form').addEventListener('submit', handleEditCard);

  // Initialize Backup / Onboarding
  await initBackupFile();
  checkFirstTimeUser();
  loadCloudConfig(); // Load GitHub configuration if available

  // Initialize auto-save background checker (every 5 seconds)
  setInterval(checkAndAutoSave, 5000);

  // Render initial dynamic fields for the default categories
  onAddCategoryChange(document.getElementById('add-category').value);
  onEditCategoryChange(document.getElementById('edit-category').value);
  
  switchTab('revise'); // Default tab
  
  // Setup unlock trigger on user click for auto-save locks
  document.addEventListener('click', requestInitialPermissionUnlock);

  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js?v=2.0')
        .then(reg => console.log('Service Worker registered', reg))
        .catch(err => console.error('Service Worker registration failed', err));
    });
  }
});

// Check if first-time user and display onboarding welcomes
function checkFirstTimeUser() {
  const hasSetup = getCookie('has_backup_setup');
  if (!hasSetup) {
    document.getElementById('welcome-modal').classList.add('open');
  }
}

// Onboard using a directory picker starting in downloads, creating subfolder and file
async function onboardBackupFolderSelect() {
  if (!('showDirectoryPicker' in window)) {
    runOnboardFallback();
    return;
  }

  try {
    const parentDirHandle = await window.showDirectoryPicker({
      startIn: 'downloads'
    });
    
    const folderName = 'CDS-Flashcards';
    const fileName = 'cds-flashcards-backup.json';
    
    let subDirHandle = null;
    let existingFileHandle = null;
    
    // 1. Try to open the subfolder 'CDS-Flashcards'
    try {
      subDirHandle = await parentDirHandle.getDirectoryHandle(folderName, { create: false });
    } catch (e) {
      // subfolder doesn't exist
    }

    if (subDirHandle) {
      // 2. Subfolder exists. Check for exact backup file first
      try {
        existingFileHandle = await subDirHandle.getFileHandle(fileName, { create: false });
      } catch (e) {
        // exact file doesn't exist. search for similar files in the subfolder
      }

      if (!existingFileHandle) {
        // Look for similar files inside the subfolder
        for await (const entry of subDirHandle.values()) {
          if (entry.kind === 'file') {
            const lowerName = entry.name.toLowerCase();
            if (lowerName.endsWith('.json') && 
                (lowerName.includes('cds') || lowerName.includes('flashcard') || lowerName.includes('backup'))) {
              existingFileHandle = entry;
              break;
            }
          }
        }
      }
    }

    if (existingFileHandle) {
      // Existing backup file found inside the subfolder. Import it!
      fileHandle = existingFileHandle;
      await saveFileHandleToDB(fileHandle);
      localStorage.setItem('backup_mode', 'api');
      setCookie('has_backup_setup', 'true', 365);

      try {
        const file = await fileHandle.getFile();
        const contents = await file.text();
        processImport(contents);
        showToast(`Connected: Found and imported "${fileHandle.name}"!`);
      } catch (e) {
        console.error(e);
        showToast("Backup found, but failed to read its contents.");
      }
    } else {
      // Subfolder or backup file does not exist. Create them!
      if (!subDirHandle) {
        subDirHandle = await parentDirHandle.getDirectoryHandle(folderName, { create: true });
      }
      fileHandle = await subDirHandle.getFileHandle(fileName, { create: true });
      
      await saveFileHandleToDB(fileHandle);
      localStorage.setItem('backup_mode', 'api');
      setCookie('has_backup_setup', 'true', 365);
      
      // Write current state to initialize the file
      await writeBackupFileSilent();
      showToast(`Created save folder and file at: Downloads/${folderName}/${fileName}`);
    }

    document.getElementById('welcome-modal').classList.remove('open');
    updateBackupStatusUI();
    updateSyncIndicator('synced');
  } catch (err) {
    console.error(err);
    if (err.name !== 'AbortError') {
      showToast("Failed to configure backup folder.");
    }
  }
}

// Import an existing backup file on onboarding
async function onboardBackupFileImport() {
  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{
          description: 'JSON Files',
          accept: { 'application/json': ['.json'] }
        }]
      });
      
      const file = await handle.getFile();
      const contents = await file.text();
      processImport(contents);
      
      fileHandle = handle;
      await saveFileHandleToDB(fileHandle);
      localStorage.setItem('backup_mode', 'api');
      setCookie('has_backup_setup', 'true', 365);
      
      document.getElementById('welcome-modal').classList.remove('open');
      updateBackupStatusUI();
      updateSyncIndicator('synced');
    } catch (err) {
      console.error(err);
      if (err.name !== 'AbortError') {
        showToast("Import failed.");
      }
    }
  } else {
    // Fallback file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const contents = await file.text();
        processImport(contents);
        
        localStorage.setItem('backup_mode', 'fallback');
        setCookie('has_backup_setup', 'true', 365);
        document.getElementById('welcome-modal').classList.remove('open');
        updateBackupStatusUI();
        updateSyncIndicator('synced');
      } catch (err) {
        console.error(err);
        showToast("Import failed.");
      }
    };
    input.click();
  }
}

// Fallback setup for browser engines that lack file picker APIs
function runOnboardFallback() {
  localStorage.setItem('backup_mode', 'fallback');
  setCookie('has_backup_setup', 'true', 365);
  document.getElementById('welcome-modal').classList.remove('open');
  showToast("Using local storage. Backups will download manually.");
  updateBackupStatusUI();
  updateSyncIndicator('synced');
}

// Request permission unlock silently on first click if needed
async function requestInitialPermissionUnlock() {
  if (fileHandle && localStorage.getItem('backup_mode') === 'api') {
    const opts = { mode: 'readwrite' };
    if ((await fileHandle.queryPermission(opts)) === 'prompt') {
      try {
        await fileHandle.requestPermission(opts);
        await autoImportBackup();
      } catch (err) {
        console.warn('Auto permission grant failed:', err);
      }
    }
  }
  document.removeEventListener('click', requestInitialPermissionUnlock);
}

// Get Backup Object with cards and streak metadata
function getBackupObject() {
  return {
    cards: allCards,
    streakCount: parseInt(localStorage.getItem('streakCount') || '0', 10),
    lastRevisionDate: localStorage.getItem('lastRevisionDate') || ''
  };
}

// Load Cards from LocalStorage
function loadCardsFromStorage() {
  const raw = localStorage.getItem('cds_cards');
  allCards = raw ? JSON.parse(raw) : [];
  if (!lastSavedJsonStr) {
    lastSavedJsonStr = JSON.stringify(getBackupObject());
  }
}

// Save Cards to LocalStorage
function saveCardsToStorage() {
  localStorage.setItem('cds_cards', JSON.stringify(allCards));
}

// Toast Notification
function showToast(message) {
  const toast = document.getElementById('toast-notification');
  toast.innerText = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// Routing / Tab switching
function switchTab(tabId) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const navItem = document.getElementById(`nav-${tabId}`);
  if (navItem) navItem.classList.add('active');

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.remove('active');
  });

  document.getElementById(`tab-${tabId}`).classList.add('active');

  if (tabId === 'revise') {
    loadRevisionDeck();
  } else if (tabId === 'quiz') {
    loadQuizDeck();
  } else if (tabId === 'browse') {
    loadBrowseDeck();
  } else if (tabId === 'stats') {
    loadStats();
  }
}

// Streak logic
function initStreak() {
  const today = getLocalDateString();
  let streakCount = parseInt(localStorage.getItem('streakCount') || '0', 10);
  const lastRevisionDate = localStorage.getItem('lastRevisionDate');

  if (lastRevisionDate) {
    const lastDate = new Date(lastRevisionDate);
    const currDate = new Date(today);
    const diffTime = Math.abs(currDate - lastDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 1 && lastRevisionDate !== today) {
      streakCount = 0;
      localStorage.setItem('streakCount', '0');
    }
  } else {
    streakCount = 0;
  }
  
  updateStreakUI(streakCount);
}

function updateStreakUI(count) {
  document.getElementById('header-streak-count').innerText = count;
  const statsStreak = document.getElementById('stats-streak');
  if (statsStreak) statsStreak.innerText = count;
}

function incrementStreak() {
  const today = getLocalDateString();
  const lastRevisionDate = localStorage.getItem('lastRevisionDate');
  let streakCount = parseInt(localStorage.getItem('streakCount') || '0', 10);

  if (lastRevisionDate === today) {
    return;
  }

  if (lastRevisionDate) {
    const lastDate = new Date(lastRevisionDate);
    const currDate = new Date(today);
    const diffTime = Math.abs(currDate - lastDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      streakCount += 1;
    } else {
      streakCount = 1;
    }
  } else {
    streakCount = 1;
  }

  localStorage.setItem('streakCount', streakCount.toString());
  localStorage.setItem('lastRevisionDate', today);
  updateStreakUI(streakCount);
}

// DYNAMIC INPUT FIELDS GENERATORS

function getCategoryFieldsHTML(category, prefix = 'add', initialData = {}) {
  if (category === 'Synonyms-Antonyms') {
    return `
      <div class="form-group">
        <label for="${prefix}-front">Word <span class="required">*</span></label>
        <input type="text" id="${prefix}-front" value="${initialData.front || ''}" placeholder="e.g. Abound" required>
      </div>
      <div class="form-group">
        <label for="${prefix}-synonyms">Synonyms <span class="required">*</span></label>
        <input type="text" id="${prefix}-synonyms" value="${initialData.synonyms || ''}" placeholder="e.g. Flourish, Plentiful (comma-separated)" required>
      </div>
      <div class="form-group">
        <label for="${prefix}-antonyms">Antonyms <span class="required">*</span></label>
        <input type="text" id="${prefix}-antonyms" value="${initialData.antonyms || ''}" placeholder="e.g. Lack, Scant (comma-separated)" required>
      </div>
      <div class="form-group">
        <label for="${prefix}-back">Meaning / Definition <span class="required">*</span></label>
        <textarea id="${prefix}-back" placeholder="Enter meaning or explanation..." rows="3" required>${initialData.back || ''}</textarea>
      </div>
    `;
  } else if (category === 'One-word Substitution') {
    return `
      <div class="form-group">
        <label for="${prefix}-front">Phrase / Description <span class="required">*</span></label>
        <textarea id="${prefix}-front" placeholder="e.g. A person who writes dictionaries" rows="2" required>${initialData.front || ''}</textarea>
      </div>
      <div class="form-group">
        <label for="${prefix}-back">One-Word Substitute <span class="required">*</span></label>
        <input type="text" id="${prefix}-back" value="${initialData.back || ''}" placeholder="e.g. Lexicographer" required>
      </div>
    `;
  } else {
    // Default Layout
    return `
      <div class="form-group">
        <label for="${prefix}-front">Front Side <span class="required">*</span></label>
        <input type="text" id="${prefix}-front" value="${initialData.front || ''}" placeholder="Word, idiom, or grammar rule..." required>
      </div>
      <div class="form-group">
        <label for="${prefix}-back">Back Side (Meaning / Explanation) <span class="required">*</span></label>
        <textarea id="${prefix}-back" placeholder="Enter details, meanings, or explanations..." rows="4" required>${initialData.back || ''}</textarea>
      </div>
    `;
  }
}

function onAddCategoryChange(category) {
  addDynamicFieldsContainer.innerHTML = getCategoryFieldsHTML(category, 'add');
}

function onEditCategoryChange(category, initialData = {}) {
  editDynamicFieldsContainer.innerHTML = getCategoryFieldsHTML(category, 'edit', initialData);
}

// RENDER HELPER FOR CARD BACK (Synonyms/Antonyms Custom View)
function getCardBackHTML(card) {
  if (card.category === 'Synonyms-Antonyms') {
    return `
      <div>${card.back}</div>
      <div class="card-synonyms-antonyms-container">
        <div class="card-syn-ant-box">
          <div class="card-syn-ant-label card-syn-label">Synonyms</div>
          <div class="card-syn-ant-values">${card.synonyms || 'N/A'}</div>
        </div>
        <div class="card-syn-ant-box">
          <div class="card-syn-ant-label card-ant-label">Antonyms</div>
          <div class="card-syn-ant-values">${card.antonyms || 'N/A'}</div>
        </div>
      </div>
    `;
  }
  return `<div>${card.back}</div>`;
}


// REVISE DECK FUNCTIONS

function loadRevisionDeck() {
  loadCardsFromStorage();
  const today = getLocalDateString();
  
  // Filter due cards
  dueCards = allCards.filter(card => card.next_review_date <= today);
  dueCards.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  
  currentIndex = 0;
  resetCardFlipState();
  renderRevisionCard();
}

// Revise again resets the deck to study all cards from the starting (chronologically)
function resetRevisionQueue() {
  loadCardsFromStorage();
  
  // Populate revision deck with ALL cards in the database, starting from the oldest
  dueCards = [...allCards];
  dueCards.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  
  currentIndex = 0;
  resetCardFlipState();
  renderRevisionCard();
  showToast("Revising all cards from the beginning.");
}

function resetCardFlipState() {
  isFlipped = false;
  flashcard.classList.remove('flipped');
  reviewActions.classList.remove('show');
}

function renderRevisionCard() {
  if (dueCards.length === 0 || currentIndex >= dueCards.length) {
    revisionContent.classList.add('hidden');
    reviseEmpty.classList.remove('hidden');
    
    if (currentIndex > 0) {
      document.getElementById('empty-state-title').innerText = "Session Complete!";
      document.getElementById('empty-state-message').innerText = "Excellent job! You finished the revision queue.";
    } else {
      document.getElementById('empty-state-title').innerText = "You're All Caught Up!";
      document.getElementById('empty-state-message').innerText = "No cards due for revision today. Add some cards to kickstart your preparation.";
    }
    
    reviseProgress.innerText = `0 of 0`;
    return;
  }

  revisionContent.classList.remove('hidden');
  reviseEmpty.classList.add('hidden');

  const card = dueCards[currentIndex];
  
  // Render Front
  cardFrontTag.innerText = card.category;
  cardFrontText.innerText = card.front;

  // Render Back
  cardBackTag.innerText = card.category;
  cardBackText.innerHTML = getCardBackHTML(card);
  
  if (card.example && card.example.trim()) {
    cardBackExample.innerText = card.example.trim();
    cardBackExampleContainer.classList.remove('hidden');
  } else {
    cardBackExampleContainer.classList.add('hidden');
  }

  reviseProgress.innerText = `${currentIndex + 1} of ${dueCards.length}`;
}

function flipCard() {
  isFlipped = !isFlipped;
  if (isFlipped) {
    flashcard.classList.add('flipped');
    reviewActions.classList.add('show');
  } else {
    flashcard.classList.remove('flipped');
    reviewActions.classList.remove('show');
  }
}

function submitReview(event, action) {
  event.stopPropagation();

  const card = dueCards[currentIndex];
  const cardIndex = allCards.findIndex(c => c.id === card.id);

  if (cardIndex === -1) return;

  if (action === 'got_it') {
    allCards[cardIndex].status = 'known';
    allCards[cardIndex].next_review_date = getLocalDateString(3); // 3 days
  } else if (action === 'still_learning') {
    allCards[cardIndex].status = 'learning';
    allCards[cardIndex].next_review_date = getLocalDateString(1); // 1 day
  }

  saveCardsToStorage();
  incrementStreak();
  resetCardFlipState();

  setTimeout(() => {
    if (action === 'still_learning') {
      dueCards.push(card); // Re-queue in session
    }
    
    currentIndex++;
    renderRevisionCard();
  }, 400);
}


// PRACTICE QUIZ FUNCTIONS (Upgraded 20/20 limit, score checks, min 10 rules)

function loadQuizDeck() {
  loadCardsFromStorage();
  
  // Force reset screens
  quizStartScreen.classList.remove('hidden');
  quizGameScreen.classList.add('hidden');
  quizResultsScreen.classList.add('hidden');

  const btnStartQuiz = document.getElementById('btn-start-quiz');
  const thresholdMsg = document.getElementById('quiz-threshold-msg');

  // Verify quiz threshold (minimum of 10 data items)
  if (allCards.length < 10) {
    btnStartQuiz.setAttribute('disabled', 'true');
    thresholdMsg.innerText = `You need at least 10 cards to start a quiz. (Current deck size: ${allCards.length}/10)`;
    thresholdMsg.style.color = 'var(--primary)';
  } else {
    btnStartQuiz.removeAttribute('disabled');
    thresholdMsg.innerText = `Ready! You have ${allCards.length} cards available. Press below to start the quiz.`;
    thresholdMsg.style.color = '#6A8E61'; // success sage green
  }
}

function startQuiz() {
  quizStartScreen.classList.add('hidden');
  quizGameScreen.classList.remove('hidden');
  quizResultsScreen.classList.add('hidden');

  // Setup Quiz cards:
  // If data <= 20, put all data shuffled. If data > 20, choose 20 random items
  let shuffledDeck = shuffleArray(allCards);
  if (shuffledDeck.length > 20) {
    quizCards = shuffledDeck.slice(0, 20);
  } else {
    quizCards = shuffledDeck;
  }

  quizIndex = 0;
  quizScore = 0;
  isQuizFlipped = false;
  
  resetQuizCardState();
  renderQuizCard();
}

function resetQuizCardState() {
  isQuizFlipped = false;
  quizFlashcard.classList.remove('flipped');
  quizActions.classList.remove('show');
}

function renderQuizCard() {
  const card = quizCards[quizIndex];

  // Progress UI
  quizProgress.innerText = `Card ${quizIndex + 1} of ${quizCards.length}`;
  quizScoreIndicator.innerText = `Score: ${quizScore}`;

  // Card details
  quizFrontTag.innerText = card.category;
  quizFrontText.innerText = card.front;

  quizBackTag.innerText = card.category;
  quizBackText.innerHTML = getCardBackHTML(card);

  if (card.example && card.example.trim()) {
    quizBackExample.innerText = card.example.trim();
    quizBackExampleContainer.classList.remove('hidden');
  } else {
    quizBackExampleContainer.classList.add('hidden');
  }
}

function flipQuizCard() {
  isQuizFlipped = !isQuizFlipped;
  if (isQuizFlipped) {
    quizFlashcard.classList.add('flipped');
    quizActions.classList.add('show');
  } else {
    quizFlashcard.classList.remove('flipped');
    quizActions.classList.remove('show');
  }
}

function submitQuizAnswer(event, isCorrect) {
  event.stopPropagation();

  if (isCorrect) {
    quizScore++;
  }

  resetQuizCardState();

  // Wait for transition before loading next card
  setTimeout(() => {
    quizIndex++;
    if (quizIndex < quizCards.length) {
      renderQuizCard();
    } else {
      showQuizResults();
    }
  }, 400);
}

function showQuizResults() {
  quizGameScreen.classList.add('hidden');
  quizResultsScreen.classList.remove('hidden');

  const scoreText = document.getElementById('quiz-final-score');
  const feedbackText = document.getElementById('quiz-feedback-text');
  const resultIcon = document.getElementById('quiz-result-icon');

  scoreText.innerText = `${quizScore} / ${quizCards.length}`;
  
  const percentage = (quizScore / quizCards.length) * 100;

  if (percentage === 100) {
    resultIcon.innerHTML = '<i class="fa-solid fa-trophy"></i>';
    resultIcon.style.color = 'var(--secondary)'; // gold/mustard
    feedbackText.innerText = "Perfect Score! 🌟 Excellent mastery of your deck.";
  } else if (percentage >= 80) {
    resultIcon.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    resultIcon.style.color = '#6A8E61'; // sage green
    feedbackText.innerText = "Great Job! 👏 You're doing amazing, keep it up.";
  } else if (percentage >= 50) {
    resultIcon.innerHTML = '<i class="fa-solid fa-thumbs-up"></i>';
    resultIcon.style.color = 'var(--secondary)';
    feedbackText.innerText = "Good Effort! 👍 Reviewing your learning cards will help you score higher next time.";
  } else {
    resultIcon.innerHTML = '<i class="fa-solid fa-book-open-reader"></i>';
    resultIcon.style.color = 'var(--text-light)';
    feedbackText.innerText = "Keep Studying! 📚 More practice will make it perfect.";
  }
}

function exitQuizToStart() {
  quizResultsScreen.classList.add('hidden');
  loadQuizDeck();
}


// ADD CARD FUNCTIONS

function handleAddCard(event) {
  event.preventDefault();

  const category = document.getElementById('add-category').value;
  const front = document.getElementById('add-front').value.trim();
  const back = document.getElementById('add-back').value.trim();
  const example = document.getElementById('add-example').value.trim();

  if (!category || !front || !back) {
    showToast('Please fill out all required fields.');
    return;
  }

  const newCard = {
    id: Date.now(),
    category,
    front,
    back,
    example,
    status: 'learning',
    next_review_date: getLocalDateString(), // Joins queue today
    created_at: new Date().toISOString()
  };

  // Add specific category attributes
  if (category === 'Synonyms-Antonyms') {
    newCard.synonyms = document.getElementById('add-synonyms').value.trim();
    newCard.antonyms = document.getElementById('add-antonyms').value.trim();
  }

  allCards.push(newCard);
  saveCardsToStorage();
  
  showToast('Flashcard added successfully!');
  document.getElementById('add-card-form').reset();
  onAddCategoryChange(document.getElementById('add-category').value);
  
  switchTab('revise');
}

// BROWSE/MANAGE FUNCTIONS

function loadBrowseDeck() {
  loadCardsFromStorage();
  filterCards();
}

function filterCards() {
  const searchQuery = document.getElementById('search-input').value.toLowerCase().trim();
  const categoryFilter = document.getElementById('category-filter').value;
  
  const filtered = allCards.filter(card => {
    const matchesSearch = card.front.toLowerCase().includes(searchQuery) || 
                          card.back.toLowerCase().includes(searchQuery) ||
                          (card.example && card.example.toLowerCase().includes(searchQuery)) ||
                          (card.synonyms && card.synonyms.toLowerCase().includes(searchQuery)) ||
                          (card.antonyms && card.antonyms.toLowerCase().includes(searchQuery));
    const matchesCategory = categoryFilter === '' || card.category === categoryFilter;
    
    return matchesSearch && matchesCategory;
  });

  renderBrowseCards(filtered);
}

function renderBrowseCards(cards) {
  const grid = document.getElementById('cards-grid');
  const browseEmpty = document.getElementById('browse-empty');
  grid.innerHTML = '';

  if (cards.length === 0) {
    browseEmpty.classList.remove('hidden');
    return;
  }
  browseEmpty.classList.add('hidden');

  cards.forEach(card => {
    const cardEl = document.createElement('div');
    cardEl.className = 'manage-card';
    
    let bodyHtml = `<div>${card.back}</div>`;
    if (card.category === 'Synonyms-Antonyms') {
      bodyHtml += `
        <div style="font-size: 0.8rem; margin-top: 6px; color: var(--text-secondary)">
          <strong>Synonyms:</strong> ${card.synonyms || 'N/A'}<br>
          <strong>Antonyms:</strong> ${card.antonyms || 'N/A'}
        </div>
      `;
    }

    const exampleHtml = card.example && card.example.trim() 
      ? `<div class="manage-card-example">"${card.example.trim()}"</div>` 
      : '';

    cardEl.innerHTML = `
      <div class="manage-card-header">
        <span class="card-category-tag">${card.category}</span>
        <span class="status-badge ${card.status}">${card.status === 'known' ? 'mastered' : 'learning'}</span>
      </div>
      <div class="manage-card-front">${card.front}</div>
      <div class="manage-card-body">
        ${bodyHtml}
        ${exampleHtml}
      </div>
      <div class="manage-card-footer">
        <span style="font-size: 0.75rem; color: var(--text-light)">Due: ${card.next_review_date}</span>
        <div class="card-actions">
          <button class="btn-icon btn-edit" title="Edit Card" onclick="openEditModal(${card.id})">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn-icon btn-delete" title="Delete Card" onclick="deleteCard(${card.id})">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
    grid.appendChild(cardEl);
  });
}

function deleteCard(id) {
  if (!confirm('Are you sure you want to delete this flashcard?')) return;

  allCards = allCards.filter(card => card.id !== id);
  saveCardsToStorage();
  showToast('Card deleted.');
  loadBrowseDeck();
}

// EDIT MODAL FUNCTIONS

function openEditModal(cardId) {
  const card = allCards.find(c => c.id === cardId);
  if (!card) return;

  editCardId.value = card.id;
  editCategory.value = card.category;
  
  onEditCategoryChange(card.category, card);

  // Edit fields values
  document.getElementById('edit-front').value = card.front;
  document.getElementById('edit-back').value = card.back;
  editExample.value = card.example || '';

  if (card.category === 'Synonyms-Antonyms') {
    document.getElementById('edit-synonyms').value = card.synonyms || '';
    document.getElementById('edit-antonyms').value = card.antonyms || '';
  }

  editModal.classList.add('open');
}

function closeEditModal() {
  editModal.classList.remove('open');
  editCardForm.reset();
}

function handleEditCard(event) {
  event.preventDefault();

  const id = parseInt(editCardId.value, 10);
  const category = editCategory.value;
  const front = document.getElementById('edit-front').value.trim();
  const back = document.getElementById('edit-back').value.trim();
  const example = editExample.value.trim();

  if (!front || !back || !category) {
    showToast('Please fill out all required fields.');
    return;
  }

  const cardIndex = allCards.findIndex(c => c.id === id);
  if (cardIndex !== -1) {
    allCards[cardIndex].category = category;
    allCards[cardIndex].front = front;
    allCards[cardIndex].back = back;
    allCards[cardIndex].example = example;

    if (category === 'Synonyms-Antonyms') {
      allCards[cardIndex].synonyms = document.getElementById('edit-synonyms').value.trim();
      allCards[cardIndex].antonyms = document.getElementById('edit-antonyms').value.trim();
    } else {
      delete allCards[cardIndex].synonyms;
      delete allCards[cardIndex].antonyms;
    }

    saveCardsToStorage();
    showToast('Card updated successfully!');
    closeEditModal();
    loadBrowseDeck();
  } else {
    showToast('Error: Card not found.');
  }
}

// STATS FUNCTIONS

function loadStats() {
  loadCardsFromStorage();

  const total = allCards.length;
  const mastered = allCards.filter(c => c.status === 'known').length;
  const today = getLocalDateString();
  const due = allCards.filter(c => c.next_review_date <= today).length;
  const streak = parseInt(localStorage.getItem('streakCount') || '0', 10);

  // Update UI elements
  document.getElementById('stats-total').innerText = total;
  document.getElementById('stats-mastered').innerText = mastered;
  document.getElementById('stats-due').innerText = due;
  document.getElementById('stats-streak').innerText = streak;

  // Update Progress Bar
  const progressFill = document.getElementById('stats-progress-bar');
  const progressText = document.getElementById('stats-progress-text');
  
  const percentage = total > 0 ? Math.round((mastered / total) * 100) : 0;
  progressFill.style.width = `${percentage}%`;
  progressText.innerText = `${percentage}% of your deck is mastered.`;

  updateBackupStatusUI();
}


// BACKUP & SYNC MODULE (IndexedDB + File System Access API + Interval Sync)

// Open IndexedDB
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('CDSBackupDB', 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      db.createObjectStore('handles');
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Save FileHandle to IndexedDB
async function saveFileHandleToDB(handle) {
  const db = await openIndexedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    const store = tx.objectStore('handles');
    const request = store.put(handle, 'backupFile');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Retrieve FileHandle from IndexedDB
async function getFileHandleFromDB() {
  try {
    const db = await openIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const store = tx.objectStore('handles');
      const request = store.get('backupFile');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    return null;
  }
}

// Initialize Backup Handle on Startup
async function initBackupFile() {
  if ('showDirectoryPicker' in window) {
    try {
      fileHandle = await getFileHandleFromDB();
      if (fileHandle) {
        localStorage.setItem('backup_mode', 'api');
        // Retrieve permission status
        const opts = { mode: 'readwrite' };
        const permission = await fileHandle.queryPermission(opts);
        if (permission === 'granted') {
          updateSyncIndicator('synced');
          await autoImportBackup(); // Read initial contents
        } else {
          updateSyncIndicator('locked'); // Needs permission unlock
        }
      }
    } catch (err) {
      console.error('Failed to restore file handle:', err);
    }
  } else {
    if (localStorage.getItem('backup_mode') === 'api') {
      localStorage.removeItem('backup_mode');
    }
  }
  updateBackupStatusUI();
}

// Auto Import database from configured file (Run on page reload)
async function autoImportBackup() {
  if (!fileHandle) return;
  try {
    const file = await fileHandle.getFile();
    const contents = await file.text();
    if (contents && contents.trim()) {
      processImport(contents);
    }
  } catch (err) {
    console.error("Auto import failed:", err);
  }
}

// Configure backup folder location starting in downloads, checking subfolder and file
async function setupBackupFolder() {
  if (!('showDirectoryPicker' in window)) {
    showToast("Directory configuration not supported on this browser. Backups will download manually.");
    localStorage.setItem('backup_mode', 'fallback');
    updateBackupStatusUI();
    return;
  }

  try {
    const parentDirHandle = await window.showDirectoryPicker({
      startIn: 'downloads'
    });
    
    const folderName = 'CDS-Flashcards';
    const fileName = 'cds-flashcards-backup.json';
    
    let subDirHandle = null;
    let existingFileHandle = null;
    
    // 1. Try to open the subfolder 'CDS-Flashcards'
    try {
      subDirHandle = await parentDirHandle.getDirectoryHandle(folderName, { create: false });
    } catch (e) {
      // subfolder doesn't exist
    }

    if (subDirHandle) {
      // 2. Subfolder exists. Check for exact backup file first
      try {
        existingFileHandle = await subDirHandle.getFileHandle(fileName, { create: false });
      } catch (e) {
        // exact file doesn't exist. search for similar files in the subfolder
      }

      if (!existingFileHandle) {
        // Look for similar files inside the subfolder
        for await (const entry of subDirHandle.values()) {
          if (entry.kind === 'file') {
            const lowerName = entry.name.toLowerCase();
            if (lowerName.endsWith('.json') && 
                (lowerName.includes('cds') || lowerName.includes('flashcard') || lowerName.includes('backup'))) {
              existingFileHandle = entry;
              break;
            }
          }
        }
      }
    }

    if (existingFileHandle) {
      // Ask user if they want to import the existing file or overwrite it
      const shouldImport = confirm(`Found existing backup file "${existingFileHandle.name}" in Downloads/${folderName}. Would you like to import its contents? Tapping "Cancel" will write your current deck to it instead.`);
      
      fileHandle = existingFileHandle;
      await saveFileHandleToDB(fileHandle);
      localStorage.setItem('backup_mode', 'api');
      setCookie('has_backup_setup', 'true', 365);

      if (shouldImport) {
        try {
          const file = await fileHandle.getFile();
          const contents = await file.text();
          processImport(contents);
          showToast(`Connected: Found and imported "${fileHandle.name}"!`);
        } catch (e) {
          console.error(e);
          showToast("Failed to read the existing backup file.");
        }
      } else {
        // Overwrite existing file with current memory state
        await writeBackupFileSilent();
        showToast(`Backup configured and saved to existing Downloads/${folderName}/${fileHandle.name}.`);
      }
    } else {
      // Subfolder or backup file does not exist. Create them!
      if (!subDirHandle) {
        subDirHandle = await parentDirHandle.getDirectoryHandle(folderName, { create: true });
      }
      fileHandle = await subDirHandle.getFileHandle(fileName, { create: true });
      
      await saveFileHandleToDB(fileHandle);
      localStorage.setItem('backup_mode', 'api');
      setCookie('has_backup_setup', 'true', 365);
      
      // Write current state to initialize the file
      await writeBackupFileSilent();
      showToast(`Created save folder and file at: Downloads/${folderName}/${fileName}`);
    }

    updateBackupStatusUI();
    updateSyncIndicator('synced');
  } catch (err) {
    console.error(err);
    if (err.name !== 'AbortError') {
      showToast("Failed to configure backup folder.");
    }
  }
}

// Trigger Manual Save
async function triggerBackup() {
  const mode = localStorage.getItem('backup_mode');
  
  if (mode === 'api' && fileHandle) {
    try {
      const opts = { mode: 'readwrite' };
      if ((await fileHandle.queryPermission(opts)) !== 'granted') {
        if ((await fileHandle.requestPermission(opts)) !== 'granted') {
          showToast("Write permission denied. Cannot overwrite.");
          return;
        }
      }

      updateSyncIndicator('saving');
      await writeBackupFileSilent();
      showToast("Backup saved and overwritten!");
      updateSyncIndicator('synced');
    } catch (err) {
      console.error(err);
      showToast("Backup failed. Please configure file again.");
    }
  } else {
    downloadBackupFallback();
  }
}

// Background auto-save writer
async function writeBackupFileSilent() {
  if (!fileHandle) return;
  try {
    const writable = await fileHandle.createWritable();
    const backupObj = getBackupObject();
    const data = JSON.stringify(backupObj, null, 2);
    await writable.write(data);
    await writable.close();
    lastSavedJsonStr = JSON.stringify(backupObj); // Update reference tracker
  } catch (err) {
    console.error("Silent write failed:", err);
    throw err;
  }
}

// Download browser Blob backup (fallback mode)
function downloadBackupFallback() {
  if (allCards.length === 0) {
    showToast("Your deck is empty. Nothing to backup!");
    return;
  }
  const backupObj = getBackupObject();
  const data = JSON.stringify(backupObj, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cds-flashcards-backup.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Backup downloaded.");
}

// Trigger Manual Import / Restore
async function triggerImport() {
  if ('showOpenFilePicker' in window) {
    try {
      const [fileHandleOpen] = await window.showOpenFilePicker({
        types: [{
          description: 'JSON Files',
          accept: { 'application/json': ['.json'] }
        }]
      });
      const file = await fileHandleOpen.getFile();
      const contents = await file.text();
      processImport(contents);
    } catch (err) {
      console.error(err);
      if (err.name !== 'AbortError') {
        showToast("Restore failed.");
      }
    }
  } else {
    // Fallback file input trigger
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const contents = await file.text();
        processImport(contents);
      } catch (err) {
        console.error(err);
        showToast("Restore failed.");
      }
    };
    input.click();
  }
}

// Process imported string
function processImport(contents) {
  try {
    const importData = JSON.parse(contents);
    let cards = [];
    
    // Check if import data is direct array (old backup version compatibility)
    if (Array.isArray(importData)) {
      cards = importData;
    } else if (importData && Array.isArray(importData.cards)) {
      // New structured backup format
      cards = importData.cards;
      
      // Restore streak metadata
      const streak = importData.streakCount || 0;
      const lastRevDate = importData.lastRevisionDate || '';
      localStorage.setItem('streakCount', streak.toString());
      localStorage.setItem('lastRevisionDate', lastRevDate);
      initStreak(); // Refresh UI values
    } else {
      showToast("Invalid backup structure.");
      return;
    }

    allCards = cards;
    saveCardsToStorage();
    lastSavedJsonStr = JSON.stringify(getBackupObject()); // Update reference tracker
    
    showToast(`Restored ${cards.length} cards successfully.`);
    
    // Update displays
    loadBrowseDeck();
    loadStats();
    loadRevisionDeck();
  } catch (err) {
    console.error(err);
    showToast("Invalid JSON file.");
  }
}

// Update UI backup configuration details
function updateBackupStatusUI() {
  const btnRunBackup = document.getElementById('btn-run-backup');
  const statusText = document.getElementById('backup-status-text');
  const mode = localStorage.getItem('backup_mode');

  if (mode === 'api' && fileHandle) {
    btnRunBackup.removeAttribute('disabled');
    statusText.innerText = `Connected File: ${fileHandle.name}`;
    statusText.style.color = '#6A8E61';
  } else if (mode === 'fallback') {
    btnRunBackup.removeAttribute('disabled');
    statusText.innerText = "Fallback Mode: Will download file.";
    statusText.style.color = 'var(--secondary)';
  } else {
    btnRunBackup.setAttribute('disabled', 'true');
    statusText.innerText = "No backup file configured.";
    statusText.style.color = 'var(--text-light)';
  }
}

// Update header Sync Status dot indicator
function updateSyncIndicator(state) {
  const syncStatus = document.getElementById('header-sync-status');
  if (!syncStatus) return;

  if (state === 'synced') {
    syncStatus.style.backgroundColor = '#EDF5EC';
    syncStatus.style.borderColor = '#D6EAD4';
    syncStatus.style.color = '#6A8E61'; // Sage green
    syncStatus.innerHTML = '<i class="fa-solid fa-circle-check"></i> <span id="sync-text">Synced</span>';
  } else if (state === 'saving') {
    syncStatus.style.backgroundColor = '#FFF6EC';
    syncStatus.style.borderColor = '#FFE7CF';
    syncStatus.style.color = '#E5A338'; // Mustard orange
    syncStatus.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span id="sync-text">Saving...</span>';
  } else if (state === 'locked') {
    syncStatus.style.backgroundColor = '#FFF6EC';
    syncStatus.style.borderColor = '#FFE7CF';
    syncStatus.style.color = '#D26C1C'; // Dark orange
    syncStatus.innerHTML = '<i class="fa-solid fa-lock"></i> <span id="sync-text" style="cursor: pointer;" onclick="unlockSyncPermission()">Unlock Sync</span>';
  }
}

// Manually request file permissions if state gets locked
async function unlockSyncPermission() {
  if (fileHandle) {
    const opts = { mode: 'readwrite' };
    try {
      const permission = await fileHandle.requestPermission(opts);
      if (permission === 'granted') {
        updateSyncIndicator('synced');
        await autoImportBackup();
        showToast("Local backup sync unlocked!");
      }
    } catch (err) {
      console.error(err);
      showToast("Permission request failed.");
    }
  }
}

// BACKGROUND WORKER: Periodically check memory changes and auto-save
async function checkAndAutoSave() {
  const mode = localStorage.getItem('backup_mode');
  if (mode === 'api' && fileHandle) {
    const currentJson = JSON.stringify(getBackupObject());
    if (currentJson !== lastSavedJsonStr) {
      // Memory state changed! Auto-save to file.
      try {
        const opts = { mode: 'readwrite' };
        const permission = await fileHandle.queryPermission(opts);
        if (permission === 'granted') {
          updateSyncIndicator('saving');
          await writeBackupFileSilent();
          updateSyncIndicator('synced');
          console.log("Auto-save completed.");
        } else {
          updateSyncIndicator('locked');
        }
      } catch (err) {
        console.error("Auto-save failed:", err);
      }
    }
  }
}

// GITHUB CLOUD SYNC MODULE

function getCloudConfig() {
  return {
    username: localStorage.getItem('gh_username') || '',
    repo: localStorage.getItem('gh_repo') || '',
    branch: localStorage.getItem('gh_branch') || 'main',
    token: localStorage.getItem('gh_token') || ''
  };
}

function loadCloudConfig() {
  const config = getCloudConfig();
  const usernameInput = document.getElementById('gh-username');
  const repoInput = document.getElementById('gh-repo');
  const branchInput = document.getElementById('gh-branch');
  const tokenInput = document.getElementById('gh-token');

  if (usernameInput) usernameInput.value = config.username;
  if (repoInput) repoInput.value = config.repo;
  if (branchInput) branchInput.value = config.branch;
  if (tokenInput) tokenInput.value = config.token;
  
  updateCloudSyncUI();
}

function saveCloudConfig() {
  const username = document.getElementById('gh-username').value.trim();
  const repo = document.getElementById('gh-repo').value.trim();
  const branch = document.getElementById('gh-branch').value.trim() || 'main';
  const token = document.getElementById('gh-token').value.trim();
  
  if (!username || !repo || !token) {
    showToast("Please fill in Username, Repository, and Token.");
    return;
  }
  
  localStorage.setItem('gh_username', username);
  localStorage.setItem('gh_repo', repo);
  localStorage.setItem('gh_branch', branch);
  localStorage.setItem('gh_token', token);
  
  showToast("GitHub Cloud Sync configuration saved!");
  updateCloudSyncUI();
}

function disconnectCloudSync() {
  if (!confirm("Are you sure you want to disconnect and clear GitHub configurations?")) return;
  
  localStorage.removeItem('gh_username');
  localStorage.removeItem('gh_repo');
  localStorage.removeItem('gh_branch');
  localStorage.removeItem('gh_token');
  localStorage.removeItem('gh_last_sync');
  
  const usernameInput = document.getElementById('gh-username');
  const repoInput = document.getElementById('gh-repo');
  const branchInput = document.getElementById('gh-branch');
  const tokenInput = document.getElementById('gh-token');

  if (usernameInput) usernameInput.value = '';
  if (repoInput) repoInput.value = '';
  if (branchInput) branchInput.value = 'main';
  if (tokenInput) tokenInput.value = '';
  
  showToast("Disconnected from GitHub Cloud Sync.");
  updateCloudSyncUI();
}

function updateCloudSyncUI() {
  const config = getCloudConfig();
  const statusText = document.getElementById('github-sync-status-text');
  const btnSync = document.getElementById('btn-github-sync');
  const lastSync = localStorage.getItem('gh_last_sync');
  
  if (!statusText || !btnSync) return;

  if (config.username && config.repo && config.token) {
    btnSync.removeAttribute('disabled');
    if (lastSync) {
      statusText.innerText = `Connected. Last synced: ${lastSync}`;
      statusText.style.color = '#6A8E61';
    } else {
      statusText.innerText = "Connected. Ready to sync.";
      statusText.style.color = 'var(--secondary)';
    }
  } else {
    btnSync.setAttribute('disabled', 'true');
    statusText.innerText = "No GitHub configuration saved.";
    statusText.style.color = 'var(--text-light)';
  }
}

// UTF-8 base64 encoding and decoding helpers
function unicodeBtoa(str) {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
    return String.fromCharCode('0x' + p1);
  }));
}

function unicodeAtob(str) {
  return decodeURIComponent(Array.prototype.map.call(atob(str), (c) => {
    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
  }).join(''));
}

async function syncWithGitHub() {
  const config = getCloudConfig();
  if (!config.username || !config.repo || !config.token) {
    showToast("GitHub sync settings are incomplete.");
    return;
  }
  
  const btnSync = document.getElementById('btn-github-sync');
  const statusText = document.getElementById('github-sync-status-text');
  
  if (!btnSync || !statusText) return;

  btnSync.setAttribute('disabled', 'true');
  btnSync.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> Syncing...';
  statusText.innerText = "Connecting to GitHub...";
  statusText.style.color = 'var(--secondary)';
  
  const path = 'cds-flashcards-backup.json';
  const url = `https://api.github.com/repos/${config.username}/${config.repo}/contents/${path}?ref=${config.branch}&_t=${Date.now()}`;
  
  try {
    const getRes = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `token ${config.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    let remoteData = null;
    let fileSha = null;
    
    if (getRes.status === 200) {
      const resJson = await getRes.json();
      fileSha = resJson.sha;
      const decodedContent = unicodeAtob(resJson.content.replace(/\s/g, ''));
      try {
        remoteData = JSON.parse(decodedContent);
      } catch (err) {
        console.error("Failed to parse remote JSON, starting clean overwrite:", err);
      }
    } else if (getRes.status !== 404) {
      const errRes = await getRes.json().catch(() => ({}));
      showToast(`GitHub Sync failed: ${errRes.message || getRes.statusText}`);
      loadCloudConfig();
      return;
    }
    
    let mergedCards = [];
    let mergedStreakCount = 0;
    let mergedLastRevDate = '';
    
    if (remoteData) {
      const mergedMap = new Map();
      const remoteCards = remoteData.cards || [];
      
      remoteCards.forEach(c => mergedMap.set(c.id, c));
      
      allCards.forEach(localCard => {
        const remoteCard = mergedMap.get(localCard.id);
        if (!remoteCard) {
          mergedMap.set(localCard.id, localCard);
        } else {
          // Resolve review conflicts: keep the one with the newer review date
          if (localCard.next_review_date > remoteCard.next_review_date) {
            mergedMap.set(localCard.id, localCard);
          }
        }
      });
      mergedCards = Array.from(mergedMap.values());
      
      const localStreak = parseInt(localStorage.getItem('streakCount') || '0', 10);
      const remoteStreak = remoteData.streakCount || 0;
      mergedStreakCount = Math.max(localStreak, remoteStreak);
      
      const localRevDate = localStorage.getItem('lastRevisionDate') || '';
      const remoteRevDate = remoteData.lastRevisionDate || '';
      mergedLastRevDate = localRevDate > remoteRevDate ? localRevDate : remoteRevDate;
      
    } else {
      mergedCards = allCards;
      mergedStreakCount = parseInt(localStorage.getItem('streakCount') || '0', 10);
      mergedLastRevDate = localStorage.getItem('lastRevisionDate') || '';
    }
    
    allCards = mergedCards;
    saveCardsToStorage();
    localStorage.setItem('streakCount', mergedStreakCount.toString());
    localStorage.setItem('lastRevisionDate', mergedLastRevDate);
    
    initStreak();
    loadBrowseDeck();
    loadStats();
    loadRevisionDeck();
    
    const backupObj = {
      cards: allCards,
      streakCount: mergedStreakCount,
      lastRevisionDate: mergedLastRevDate
    };
    
    const putBody = {
      message: "Sync flashcards [Cloud Merge]",
      content: unicodeBtoa(JSON.stringify(backupObj, null, 2)),
      branch: config.branch
    };
    if (fileSha) {
      putBody.sha = fileSha;
    }
    
    const putRes = await fetch(`https://api.github.com/repos/${config.username}/${config.repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(putBody)
    });
    
    if (putRes.status === 200 || putRes.status === 201) {
      const now = new Date();
      const timestamp = `${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      localStorage.setItem('gh_last_sync', timestamp);
      showToast("Sync with GitHub completed successfully!");
    } else {
      const errRes = await putRes.json().catch(() => ({}));
      showToast(`GitHub Save failed: ${errRes.message || putRes.statusText}`);
    }
    
  } catch (err) {
    console.error(err);
    showToast("Network error during GitHub Sync.");
  } finally {
    btnSync.removeAttribute('disabled');
    btnSync.innerHTML = '<i class="fa-solid fa-rotate"></i> Sync with GitHub';
    loadCloudConfig();
  }
}
